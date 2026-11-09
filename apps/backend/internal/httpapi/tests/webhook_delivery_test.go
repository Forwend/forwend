package tests

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/forwend/forwend/apps/backend/internal/httpapi/invoiceapi"
	"github.com/forwend/forwend/apps/backend/internal/invoice"
	"github.com/forwend/forwend/apps/backend/internal/webhook"
)

// receiver is an endpoint's server: it answers each request with the next code it is given.
type receiver struct {
	*httptest.Server
	mu     sync.Mutex
	code   int
	got    []*http.Request
	body   [][]byte
	during func() // runs while a request waits for its answer
}

func newReceiver(t *testing.T) *receiver {
	r := &receiver{code: http.StatusOK}
	r.Server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if r.during != nil {
			r.during()
		}
		b, _ := io.ReadAll(req.Body)
		r.mu.Lock()
		defer r.mu.Unlock()
		r.got, r.body = append(r.got, req), append(r.body, b)
		if r.code == http.StatusFound {
			http.Redirect(w, req, "https://elsewhere.example/", http.StatusFound)
			return
		}
		w.WriteHeader(r.code)
	}))
	t.Cleanup(r.Close)
	return r
}

func (r *receiver) answer(code int) { r.mu.Lock(); r.code = code; r.mu.Unlock() }

func (r *receiver) requests() int { r.mu.Lock(); defer r.mu.Unlock(); return len(r.got) }

// hookEnv has a merchant whose endpoint points at a local receiver: the API refuses such a URL, so the test sets it.
type hookEnv struct {
	invoiceEnv
	shop, endpoint string
	recv           *receiver
	hooks          *webhook.Service
	client         *http.Client
	body           webhook.Body
	built          *atomic.Int32 // bodies built
}

func newHookEnv(t *testing.T) hookEnv {
	e := invoiceAPI(t)
	h := hookEnv{invoiceEnv: e, shop: e.merchant(t), endpoint: "dddddddd-0000-4000-8000-000000000001",
		recv: newReceiver(t), hooks: webhook.NewService(e.pool, webhookKey), built: new(atomic.Int32)}
	h.addEndpoint(t, h.endpoint, h.recv.URL+"/hooks?token=receiver-secret")
	// The delivery client's rules with a transport that trusts the test server: webhook.Client's own address
	// filter refuses this machine (TestClientRefusesPrivateAddressesAfterDNS).
	h.client = webhook.Client()
	h.client.Transport = h.recv.Client().Transport
	invoices := invoice.NewService(e.pool)
	h.body = func(ctx context.Context, ev webhook.Event) ([]byte, error) {
		h.built.Add(1)
		inv, err := invoices.GetOfProfile(ctx, ev.ProfileID, ev.InvoiceID)
		if err != nil {
			return nil, err
		}
		return invoiceapi.EventBody(ev, inv)
	}
	return h
}

func (h hookEnv) addEndpoint(t *testing.T, id, url string) {
	t.Helper()
	if r := h.call(t, "PUT", "/v1/profiles/"+h.shop+"/webhooks/"+id, "did:privy:alice", "",
		`{"url": "https://hooks.example/", "events": ["invoice.canceled"]}`); r.status != http.StatusCreated {
		t.Fatalf("PUT endpoint: %d %v", r.status, r.body)
	}
	h.exec(t, "UPDATE webhook_endpoints SET url = $2 WHERE id = $1", id, url)
}

// canceled makes an invoice and cancels it: one invoice.canceled event, and its id.
func (h hookEnv) canceled(t *testing.T, key string) string {
	t.Helper()
	id := h.post(t, "did:privy:alice", h.shop, key, basicBody).body["invoiceId"].(string)
	if r := h.call(t, "POST", "/v1/profiles/"+h.shop+"/invoices/"+id+"/cancel", "did:privy:alice", "", ""); r.status !=
		http.StatusOK {
		t.Fatalf("cancel: %d %v", r.status, r.body)
	}
	var event string
	if err := h.pool.QueryRow(context.Background(), "SELECT id FROM webhook_events WHERE invoice_id = $1", id).
		Scan(&event); err != nil {
		t.Fatal(err)
	}
	return event
}

func (h hookEnv) deliver(t *testing.T) {
	t.Helper()
	if err := h.hooks.Deliver(context.Background(), h.client, h.body); err != nil {
		t.Fatal(err)
	}
}

func TestWebhookBodyBuildEndsBeforeItsLeaseExpires(t *testing.T) {
	h := newHookEnv(t)
	h.canceled(t, "body-deadline")
	bounded := make(chan bool, 1)
	err := h.hooks.Deliver(context.Background(), h.client, func(ctx context.Context, _ webhook.Event) ([]byte, error) {
		deadline, ok := ctx.Deadline()
		bounded <- ok && time.Until(deadline) > 0 && time.Until(deadline) < time.Minute
		return nil, context.Canceled
	})
	if err == nil {
		t.Fatal("body build error was ignored")
	}
	select {
	case limited := <-bounded:
		if !limited {
			t.Fatal("body construction can outlive its delivery lease")
		}
	default:
		t.Fatalf("body construction did not start: %v", err)
	}
	if h.recv.requests() != 0 {
		t.Fatal("failed body construction sent a request")
	}
}

// One endpoint sends one delivery at a time: a delivery whose body can't be built must still move on the retry
// schedule, or every later delivery to its endpoint waits behind it for good.
func TestADeliveryThatCantBeBuiltFailsOnTheSchedule(t *testing.T) {
	h := newHookEnv(t)
	broken := h.canceled(t, "unbuildable")
	time.Sleep(10 * time.Millisecond)
	healthy := h.canceled(t, "healthy")
	body := func(ctx context.Context, ev webhook.Event) ([]byte, error) {
		if ev.ID == broken {
			return nil, context.DeadlineExceeded
		}
		return h.body(ctx, ev)
	}
	if err := h.hooks.Deliver(context.Background(), h.client, body); err == nil {
		t.Fatal("the failed body build was not reported")
	}
	if state, next := h.delivery(t, h.endpoint, broken); state != "pending 1" || next <= 0 || next > webhook.Retries[0] {
		t.Fatalf("the unbuildable delivery: %s, next in %v; want pending 1 on the schedule", state, next)
	}
	if got := h.attempts(t, h.endpoint); !slices.Equal(got, []string{"- not sent: Forwend could not prepare the request"}) {
		t.Fatalf("attempts %q", got)
	}
	if err := h.hooks.Deliver(context.Background(), h.client, body); err != nil {
		t.Fatal(err)
	}
	if state, _ := h.delivery(t, h.endpoint, healthy); state != "succeeded 1" || h.recv.requests() != 1 {
		t.Fatalf("the delivery behind it: %s, %d requests", state, h.recv.requests())
	}
	h.exec(t, "UPDATE webhook_deliveries SET attempts = $3, next_attempt_at = now() WHERE endpoint_id = $1 AND event_id = $2",
		h.endpoint, broken, len(webhook.Retries))
	if err := h.hooks.Deliver(context.Background(), h.client, body); err == nil {
		t.Fatal("the failed body build was not reported")
	}
	if state, _ := h.delivery(t, h.endpoint, broken); state != "failed "+strconv.Itoa(len(webhook.Retries)+1) {
		t.Fatalf("after its last attempt: %s", state)
	}
}

func TestWebhookManualQueueBudgetPreservesFinancialEvents(t *testing.T) {
	h := newHookEnv(t)
	path := "/v1/profiles/" + h.shop + "/webhooks/" + h.endpoint + "/test"
	for range webhook.ManualPendingLimit {
		if r := h.call(t, "POST", path, "did:privy:alice", "", ""); r.status != http.StatusCreated {
			t.Fatalf("queue: %d %v", r.status, r.body)
		}
	}
	r := h.call(t, "POST", path, "did:privy:alice", "", "")
	if r.status != http.StatusTooManyRequests {
		t.Fatalf("full queue: %d %v", r.status, r.body)
	}
	if code := r.body["error"].(map[string]any)["code"]; code != "webhook_queue_full" {
		t.Fatalf("queue error: %v", r.body)
	}
	h.canceled(t, "financial-event-after-manual-limit")
	var pending int
	if err := h.pool.QueryRow(t.Context(), "SELECT count(*) FROM webhook_deliveries WHERE status='pending'").Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != webhook.ManualPendingLimit+1 {
		t.Fatalf("financial event rejected: %d pending", pending)
	}
}

func (h hookEnv) secrets(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, s := range h.call(t, "GET", "/v1/profiles/"+h.shop+"/webhooks/"+h.endpoint+"/secret", "did:privy:alice", "",
		"").body["secrets"].([]any) {
		out = append(out, s.(map[string]any)["secret"].(string))
	}
	return out
}

// delivery is "status attempts" and how long until the next attempt.
func (h hookEnv) delivery(t *testing.T, endpoint, event string) (string, time.Duration) {
	t.Helper()
	var state string
	var next time.Time
	if err := h.pool.QueryRow(context.Background(), `SELECT status || ' ' || attempts, next_attempt_at
		FROM webhook_deliveries WHERE endpoint_id = $1 AND event_id = $2`, endpoint, event).Scan(&state, &next); err != nil {
		t.Fatal(err)
	}
	return state, time.Until(next)
}

func (h hookEnv) attempts(t *testing.T, endpoint string) []string {
	t.Helper()
	rows, err := h.pool.Query(context.Background(), `SELECT coalesce(status_code::text, '-') || coalesce(' ' || error, '')
		FROM webhook_attempts WHERE endpoint_id = $1 ORDER BY id`, endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// signedBy checks a Standard Webhooks signature the way a receiver does: one v1 entry per secret it may hold.
func signedBy(secret string, req *http.Request, body []byte) bool {
	key, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(req.Header.Get("webhook-id") + "." + req.Header.Get("webhook-timestamp") + "."))
	mac.Write(body)
	want := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return slices.Contains(strings.Split(req.Header.Get("webhook-signature"), " "), want)
}

// R-148, D-42: signed by every working secret, retried on the schedule with the first body, and no redirect followed.
func TestWebhookDeliveriesAreSignedAndRetried(t *testing.T) {
	h := newHookEnv(t)
	event := h.canceled(t, "key-1")
	first := h.secrets(t)

	h.recv.answer(http.StatusInternalServerError)
	h.deliver(t)
	h.deliver(t) // not due yet
	if n := h.recv.requests(); n != 1 {
		t.Fatalf("%d requests, want 1", n)
	}
	req, body := h.recv.got[0], h.recv.body[0]
	sent, _ := strconv.ParseInt(req.Header.Get("webhook-timestamp"), 10, 64)
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if req.Header.Get("webhook-id") != event || time.Since(time.Unix(sent, 0)) > time.Minute ||
		req.Header.Get("Content-Type") != "application/json" || !signedBy(first[0], req, body) ||
		req.URL.RawQuery != "token=receiver-secret" || got["id"] != event || got["type"] != "invoice.canceled" {
		t.Fatalf("first attempt: headers %v, body %v", req.Header, got)
	}
	if state, next := h.delivery(t, h.endpoint, event); state != "pending 1" || next < 4*time.Second || next > 6*time.Second {
		t.Fatalf("after a 500: %s, next in %v; want pending 1, next in 5s", state, next)
	}

	// The retry sends the same body, signed now by the new secret and the old one it replaces.
	if r := h.call(t, "POST", "/v1/profiles/"+h.shop+"/webhooks/"+h.endpoint+"/secret/rotate", "did:privy:alice", "",
		""); r.status != http.StatusCreated {
		t.Fatalf("rotate: %d %v", r.status, r.body)
	}
	h.exec(t, "UPDATE webhook_deliveries SET next_attempt_at = now()")
	h.recv.answer(http.StatusFound)
	h.deliver(t)
	if state, next := h.delivery(t, h.endpoint, event); state != "pending 2" || next < 4*time.Minute || next > 6*time.Minute {
		t.Fatalf("after a redirect: %s, next in %v; want pending 2, next in 5m", state, next)
	}
	h.exec(t, "UPDATE webhook_deliveries SET next_attempt_at = now()")
	h.recv.answer(http.StatusNoContent)
	h.deliver(t)
	both := h.secrets(t)
	retry, again := h.recv.got[2], h.recv.body[2]
	if n := h.recv.requests(); n != 3 || h.built.Load() != 1 || string(again) != string(body) || len(both) != 2 ||
		both[1] != first[0] ||
		!signedBy(both[0], retry, again) || !signedBy(both[1], retry, again) ||
		len(strings.Split(retry.Header.Get("webhook-signature"), " ")) != 2 {
		t.Fatalf("%d requests, %d bodies built; the retry's body changed %v, or it isn't signed by both secrets: %q", n,
			h.built.Load(), string(again) != string(body), retry.Header.Get("webhook-signature"))
	}
	if state, _ := h.delivery(t, h.endpoint, event); state != "succeeded 3" {
		t.Fatalf("after a 204: %s, want succeeded 3", state)
	}
	if got, want := h.attempts(t, h.endpoint), []string{"500", "302 redirects are not followed", "204"}; !slices.Equal(got,
		want) {
		t.Fatalf("attempts %q, want %q", got, want)
	}
}

// R-221: Developer mode is the dashboard's; deliveries to an endpoint of the profile's other mode stay signed.
func TestDeliveriesStaySignedWhateverTheProfilesMode(t *testing.T) {
	h := newHookEnv(t)
	h.canceled(t, "key-1")
	first := h.secrets(t)
	h.exec(t, "UPDATE profiles SET livemode = NOT livemode WHERE id = $1", h.shop)
	h.recv.answer(http.StatusNoContent)
	h.deliver(t)
	if n := h.recv.requests(); n != 1 || !signedBy(first[0], h.recv.got[0], h.recv.body[0]) {
		t.Fatalf("%d requests; signature %q", n, h.recv.got[0].Header.Get("webhook-signature"))
	}
}

// R-148: a 410, or a delivery's last failure, turns the endpoint off and emails its owner once.
func TestWebhookEndpointsTurnOff(t *testing.T) {
	h := newHookEnv(t)
	other, edge := "dddddddd-0000-4000-8000-000000000002", "dddddddd-0000-4000-8000-000000000003"
	h.addEndpoint(t, other, h.recv.URL+"/other")
	h.addEndpoint(t, edge, h.recv.URL+"/edge")
	gone := h.canceled(t, "key-1")
	waiting := h.canceled(t, "key-2")
	// Only the first event is due, and the other endpoint's delivery of it is at its last attempt.
	h.exec(t, "UPDATE webhook_deliveries SET next_attempt_at = now() + interval '1 hour' WHERE event_id = $1", waiting)
	h.exec(t, "UPDATE webhook_deliveries SET attempts = $2 WHERE endpoint_id = $1", other, len(webhook.Retries))

	// Without WEBHOOK_SECRET_KEY nothing is signed, so nothing goes.
	if err := webhook.NewService(h.pool, nil).Deliver(context.Background(), h.client, h.body); err != nil ||
		h.recv.requests() != 0 {
		t.Fatalf("with no key: %v, %d requests", err, h.recv.requests())
	}
	h.recv.answer(http.StatusGone)
	for range 2 {
		h.deliver(t)
	}
	for endpoint, want := range map[string]string{h.endpoint: "failed 1", edge: "failed 1", other: "failed " +
		strconv.Itoa(len(webhook.Retries)+1)} {
		if state, _ := h.delivery(t, endpoint, gone); state != want {
			t.Errorf("endpoint %s: %s, want %s", endpoint, state, want)
		}
	}
	rows, err := h.pool.Query(context.Background(), `SELECT w.id::text || ' ' || w.enabled || ' ' ||
		    coalesce((SELECT string_agg(o.payload->>'reason', ',') FROM outbox_events o
		              WHERE o.kind = 'webhook.disabled' AND o.endpoint_id = w.id), 'no email')
		FROM webhook_endpoints w ORDER BY w.id`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		got = append(got, s)
	}
	if want := []string{h.endpoint + " false gone", other + " false gone", edge + " false gone"}; !slices.Equal(got,
		want) {
		t.Fatalf("endpoints %q, want %q", got, want)
	}

	// The last failure without a 410 says so, one attempt before it waits 10 hours more, and a turned-off
	// endpoint's waiting delivery is not sent.
	h.exec(t, "DELETE FROM outbox_events WHERE kind = 'webhook.disabled'")
	h.exec(t, "UPDATE webhook_endpoints SET enabled = id IN ($1, $2)", other, edge)
	h.exec(t, "UPDATE webhook_deliveries SET next_attempt_at = now() WHERE event_id = $1", waiting)
	h.exec(t, "UPDATE webhook_deliveries SET attempts = $3 WHERE endpoint_id = $1 AND event_id = $2", other, waiting,
		len(webhook.Retries))
	h.exec(t, "UPDATE webhook_deliveries SET attempts = $3 WHERE endpoint_id = $1 AND event_id = $2", edge, waiting,
		len(webhook.Retries)-1)
	h.recv.answer(http.StatusServiceUnavailable)
	before := h.recv.requests()
	h.deliver(t)
	if sent := h.recv.requests() - before; sent != 2 {
		t.Fatalf("%d requests, want one to each endpoint that is on", sent)
	}
	if state, _ := h.delivery(t, h.endpoint, waiting); state != "pending 0" {
		t.Fatalf("the turned-off endpoint's delivery: %s, want pending 0", state)
	}
	if state, next := h.delivery(t, edge, waiting); state != "pending "+strconv.Itoa(len(webhook.Retries)) ||
		next < 9*time.Hour || next > 11*time.Hour {
		t.Fatalf("one attempt before the last: %s, next in %v; want pending, next in 10h", state, next)
	}
	var reason string
	if err := h.pool.QueryRow(context.Background(), `SELECT string_agg(payload->>'reason', ',') FROM outbox_events
		WHERE kind = 'webhook.disabled' AND endpoint_id = $1`, other).Scan(&reason); err != nil || reason != "failing" {
		t.Fatalf("the owner's email: %q (%v), want one, failing", reason, err)
	}
}

// A delivery whose attempt is running is not claimed again by another round.
func TestAClaimedDeliveryIsSentOnce(t *testing.T) {
	h := newHookEnv(t)
	h.canceled(t, "key-1")
	release := make(chan struct{})
	h.recv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		h.recv.mu.Lock()
		h.recv.got = append(h.recv.got, nil)
		h.recv.mu.Unlock()
		<-release
	})
	first := make(chan error, 1)
	go func() { first <- h.hooks.Deliver(context.Background(), h.client, h.body) }()
	for start := time.Now(); h.recv.requests() == 0; time.Sleep(10 * time.Millisecond) {
		if time.Since(start) > 10*time.Second {
			close(release)
			t.Fatal("the first round sent nothing")
		}
	}
	h.deliver(t)
	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if n := h.recv.requests(); n != 1 {
		t.Fatalf("%d requests, want 1", n)
	}
}

// A receiver's long non-ASCII status line is logged and counted like any failure, not resent after every lease.
func TestAHostileAnswerIsLogged(t *testing.T) {
	h := newHookEnv(t)
	event := h.canceled(t, "key-1")
	h.recv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		c, buf, _ := w.(http.Hijacker).Hijack()
		_, _ = buf.WriteString("HTTP/1.1 2" + strings.Repeat("é", 200) + "\r\n\r\n")
		_ = buf.Flush()
		c.Close()
	})
	h.deliver(t)
	if state, next := h.delivery(t, h.endpoint, event); state != "pending 1" || next < 4*time.Second {
		t.Fatalf("after the answer: %s, next in %v; want pending 1, next in 5s", state, next)
	}
	if got := h.attempts(t, h.endpoint); len(got) != 1 || !strings.Contains(got[0], "malformed HTTP status code") {
		t.Fatalf("attempts %q, want the one failure logged", got)
	}
}

// R-149: the owner reads an endpoint's deliveries with their attempts, resends one, sends a test event, and resends
// every failed one since a time.
func TestOwnerResendsAndTestsDeliveries(t *testing.T) {
	h := newHookEnv(t)
	const alice = "did:privy:alice"
	hook := "/v1/profiles/" + h.shop + "/webhooks/" + h.endpoint
	event := h.canceled(t, "key-1")
	h.exec(t, "UPDATE webhook_deliveries SET attempts = $1", len(webhook.Retries))
	h.recv.answer(http.StatusInternalServerError)
	h.deliver(t)

	r := h.call(t, "GET", hook+"/deliveries", alice, "", "")
	list, _ := r.body["deliveries"].([]any)
	if r.status != http.StatusOK || len(list) != 1 {
		t.Fatalf("deliveries: %d %v", r.status, r.body)
	}
	d := list[0].(map[string]any)
	attempts, _ := d["attempts"].([]any)
	if d["eventId"] != event || d["type"] != "invoice.canceled" || d["invoiceId"] == nil || d["number"] != float64(1) ||
		d["status"] != "failed" || d["nextAttemptAt"] != nil || len(attempts) != 1 ||
		attempts[0].(map[string]any)["statusCode"] != float64(500) || attempts[0].(map[string]any)["error"] != nil {
		t.Fatalf("the failed delivery: %v", d)
	}

	// A resend starts again from a first attempt; it waits while the endpoint is off, as its last failure left it.
	if r := h.call(t, "POST", hook+"/deliveries/"+event+"/resend", alice, "", ""); r.status != http.StatusNoContent {
		t.Fatalf("resend: %d %v", r.status, r.body)
	}
	if state, next := h.delivery(t, h.endpoint, event); state != "pending 0" || next > time.Second {
		t.Fatalf("after the resend: %s, next in %v", state, next)
	}
	h.exec(t, "UPDATE webhook_endpoints SET enabled = true")
	h.recv.answer(http.StatusOK)
	r = h.call(t, "POST", hook+"/test", alice, "", "")
	test, _ := r.body["eventId"].(string)
	if r.status != http.StatusCreated || test == "" {
		t.Fatalf("test event: %d %v", r.status, r.body)
	}
	for range 2 {
		h.deliver(t)
	}
	i := slices.IndexFunc(h.recv.got, func(req *http.Request) bool { return req.Header.Get("webhook-id") == test })
	if n := h.recv.requests(); n != 3 || i < 0 {
		t.Fatalf("%d requests, the test event's at %d", n, i)
	}
	var body map[string]any
	if err := json.Unmarshal(h.recv.body[i], &body); err != nil {
		t.Fatal(err)
	}
	if body["id"] != test || body["type"] != "webhook.test" || body["livemode"] != false ||
		len(body["data"].(map[string]any)) != 0 || !signedBy(h.secrets(t)[0], h.recv.got[i], h.recv.body[i]) {
		t.Fatalf("the test event's body %v", body)
	}
	list, _ = h.call(t, "GET", hook+"/deliveries", alice, "", "").body["deliveries"].([]any)
	if len(list) != 2 || list[0].(map[string]any)["type"] != "webhook.test" || list[0].(map[string]any)["invoiceId"] != nil ||
		list[0].(map[string]any)["status"] != "succeeded" || list[1].(map[string]any)["status"] != "succeeded" {
		t.Fatalf("deliveries, newest first: %v", list)
	}

	// Only the ones that failed since the time go again, however old: one made long ago failed just now.
	before, after := h.canceled(t, "key-2"), h.canceled(t, "key-3")
	h.exec(t, "UPDATE webhook_deliveries SET status = 'failed', updated_at = now() - interval '2 hours' WHERE event_id = $1",
		before)
	h.exec(t, "UPDATE webhook_deliveries SET status = 'failed', created_at = now() - interval '3 days' WHERE event_id = $1",
		after)
	since := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	if r := h.call(t, "POST", hook+"/deliveries/resend-failed", alice, "", `{"since": "`+since+`"}`); r.status !=
		http.StatusOK || r.body["resent"] != float64(1) {
		t.Fatalf("resend failed: %d %v", r.status, r.body)
	}
	for event, want := range map[string]string{before: "failed 0", after: "pending 0"} {
		if state, _ := h.delivery(t, h.endpoint, event); state != want {
			t.Errorf("%s: %s, want %s", event, state, want)
		}
	}

	for _, c := range []struct {
		method, path, body, code string
	}{
		{"GET", "/v1/profiles/" + h.shop + "/webhooks/dddddddd-0000-4000-8000-00000000000f/deliveries", "", "endpoint_not_found"},
		{"POST", "/v1/profiles/" + h.shop + "/webhooks/dddddddd-0000-4000-8000-00000000000f/test", "", "endpoint_not_found"},
		{"POST", hook + "/deliveries/evt_" + strings.Repeat("0", 32) + "/resend", "", "delivery_not_found"},
		{"POST", hook + "/deliveries/resend-failed", `{"since": "yesterday"}`, "invalid_value"},
		// Another profile's endpoint is not found from this one.
		{"POST", "/v1/profiles/" + h.aliceProfile + "/webhooks/" + h.endpoint + "/deliveries/" + event + "/resend", "",
			"delivery_not_found"},
		{"GET", "/v1/profiles/" + h.aliceProfile + "/webhooks/" + h.endpoint + "/deliveries", "", "endpoint_not_found"},
		{"POST", "/v1/profiles/" + h.aliceProfile + "/webhooks/" + h.endpoint + "/test", "", "endpoint_not_found"},
		{"POST", "/v1/profiles/" + h.aliceProfile + "/webhooks/" + h.endpoint + "/deliveries/resend-failed",
			`{"since": "2026-01-01T00:00:00Z"}`, "endpoint_not_found"},
	} {
		if r := h.call(t, c.method, c.path, alice, "", c.body); errorCode(r) != c.code {
			t.Errorf("%s %s: %d %v, want %s", c.method, c.path, r.status, r.body, c.code)
		}
	}
}

// R-149: an attempt in flight when the owner resends its delivery is logged, but its answer doesn't undo the resend.
func TestAnAttemptInFlightKeepsAResend(t *testing.T) {
	h := newHookEnv(t)
	event := h.canceled(t, "key-1")
	// The last attempt: its failure would turn the endpoint off.
	h.exec(t, "UPDATE webhook_deliveries SET attempts = $1", len(webhook.Retries))
	h.recv.answer(http.StatusInternalServerError)
	resent := make(chan error, 1)
	h.recv.during = func() { resent <- h.hooks.Resend(context.Background(), h.shop, h.endpoint, event) }
	h.deliver(t)
	if err := <-resent; err != nil {
		t.Fatal(err)
	}
	if state, next := h.delivery(t, h.endpoint, event); state != "pending 0" || next > time.Second {
		t.Fatalf("after the attempt: %s, next in %v", state, next)
	}
	var on bool
	if err := h.pool.QueryRow(context.Background(), "SELECT enabled FROM webhook_endpoints WHERE id = $1", h.endpoint).
		Scan(&on); err != nil || !on {
		t.Fatalf("the endpoint is on: %v %v", on, err)
	}
	if got := h.attempts(t, h.endpoint); !slices.Equal(got, []string{"500"}) {
		t.Fatalf("attempts %q, want the one in flight logged", got)
	}
}
