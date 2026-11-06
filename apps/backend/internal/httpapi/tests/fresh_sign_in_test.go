package tests

import (
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// inSession calls the API with a token of the Privy session sid, issued at iat.
func (e invoiceEnv) inSession(t *testing.T, method, path, user, sid string, iat time.Time, body string) reply {
	t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	c := claims(user)
	c["sid"], c["iat"], c["exp"] = sid, iat.Unix(), iat.Add(time.Hour).Unix()
	req.Header.Set("Authorization", "Bearer "+signES256(t, e.privyKey, c))
	return e.do(t, req)
}

// R-137, D-49: Privy keeps the session and the sign-in time when someone signs in again while signed in, so a stale
// session proves itself with Forwend's emailed code; the confirm then covers that session, and only it, for 15 min.
func TestAConfirmedCodeMakesItsSessionFresh(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	e.wallets.Lock()
	e.wallets.Emails[alice] = "alice@example.com"
	e.wallets.Unlock()
	refreshed := signedInAt.Add(2 * time.Second) // a token that isn't the sign-in's
	keys := "/v1/profiles/" + e.aliceProfile + "/keys"
	makeKey := func(sid string) reply {
		t.Helper()
		return e.inSession(t, "POST", keys, alice, sid, refreshed, `{"name": "Server", "scopes": ["invoices.read"]}`)
	}
	if r := makeKey("session-1"); r.status != http.StatusUnauthorized || errorCode(r) != "reauth_required" {
		t.Fatalf("a stale session: %d %v", r.status, r.body)
	}

	send := func() reply {
		t.Helper()
		return e.inSession(t, "POST", "/v1/me/fresh-sign-in", alice, "session-1", refreshed, "")
	}
	if r := send(); r.status != http.StatusAccepted {
		t.Fatalf("send a code: %d %v", r.status, r.body)
	}
	code := e.codes.last("alice@example.com")
	if len(code) != 6 {
		t.Fatalf("the email's code = %q", code)
	}
	if r := send(); r.status != http.StatusTooManyRequests || errorCode(r) != "code_sent_recently" {
		t.Errorf("a second code at once: %d %v", r.status, r.body)
	}
	verify := func(sid, code string) reply {
		t.Helper()
		return e.inSession(t, "POST", "/v1/me/fresh-sign-in/verify", alice, sid, refreshed, `{"code": "`+code+`"}`)
	}
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if r := verify("session-1", wrong); r.status != http.StatusUnprocessableEntity || errorCode(r) != "wrong_code" {
		t.Errorf("a wrong code: %d %v", r.status, r.body)
	}
	// The code belongs to its session: another one can't use it.
	if r := verify("session-2", code); r.status != http.StatusUnprocessableEntity {
		t.Errorf("another session's code: %d %v", r.status, r.body)
	}
	if r := verify("session-1", code); r.status != http.StatusNoContent {
		t.Fatalf("the right code: %d %v", r.status, r.body)
	}
	if r := verify("session-1", code); r.status != http.StatusUnprocessableEntity {
		t.Errorf("a code used twice: %d %v", r.status, r.body)
	}
	if r := makeKey("session-1"); r.status != http.StatusCreated {
		t.Fatalf("the confirmed session: %d %v", r.status, r.body)
	}
	if r := makeKey("session-2"); r.status != http.StatusUnauthorized || errorCode(r) != "reauth_required" {
		t.Errorf("another stale session: %d %v", r.status, r.body)
	}
	// 15 minutes later the confirm no longer counts.
	e.exec(t, "UPDATE fresh_sign_ins SET confirmed_at = confirmed_at - interval '16 minutes'")
	if r := makeKey("session-1"); r.status != http.StatusUnauthorized {
		t.Errorf("a confirm 16 minutes ago: %d %v", r.status, r.body)
	}
}

// D-49: a code can't be guessed: five wrong tries or ten minutes end it.
func TestACodeEndsAfterFiveTriesOrTenMinutes(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	e.wallets.Lock()
	e.wallets.Emails[alice] = "alice@example.com"
	e.wallets.Unlock()
	refreshed := signedInAt.Add(2 * time.Second)
	newCode := func() string {
		t.Helper()
		// Each test code waits out the 30 s between emails.
		e.exec(t, "UPDATE fresh_sign_ins SET created_at = created_at - interval '1 minute'")
		if r := e.inSession(t, "POST", "/v1/me/fresh-sign-in", alice, "session-1", refreshed, ""); r.status !=
			http.StatusAccepted {
			t.Fatalf("send a code: %d %v", r.status, r.body)
		}
		return e.codes.last("alice@example.com")
	}
	verify := func(code string) int {
		t.Helper()
		return e.inSession(t, "POST", "/v1/me/fresh-sign-in/verify", alice, "session-1", refreshed,
			`{"code": "`+code+`"}`).status
	}
	code := newCode()
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for i := range 5 {
		if got := verify(wrong); got != http.StatusUnprocessableEntity {
			t.Errorf("wrong try %d: %d", i+1, got)
		}
	}
	if got := verify(code); got != http.StatusUnprocessableEntity {
		t.Errorf("the right code after five wrong ones: %d", got)
	}
	code = newCode()
	e.exec(t, "UPDATE fresh_sign_ins SET expires_at = now() - interval '1 second' WHERE confirmed_at IS NULL")
	if got := verify(code); got != http.StatusUnprocessableEntity {
		t.Errorf("an expired code: %d", got)
	}
}

// D-49: one inbox gets at most 10 codes an hour, whatever the sessions, and requests at once send one email.
func TestCodesAreLimitedPerUser(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	e.wallets.Lock()
	e.wallets.Emails[alice] = "alice@example.com"
	e.wallets.Unlock()
	refreshed := signedInAt.Add(2 * time.Second)
	send := func(sid string) reply {
		return e.inSession(t, "POST", "/v1/me/fresh-sign-in", alice, sid, refreshed, "")
	}
	statuses := make(chan int, 5)
	var wg sync.WaitGroup
	for range 5 {
		wg.Go(func() { statuses <- send("session-0").status })
	}
	wg.Wait()
	close(statuses)
	accepted := 0
	for s := range statuses {
		if s == http.StatusAccepted {
			accepted++
		}
	}
	if accepted != 1 || e.codes.count() != 1 {
		t.Fatalf("five requests at once: %d accepted, %d emails", accepted, e.codes.count())
	}
	for i := 1; i < 10; i++ {
		if r := send("session-" + string(rune('0'+i))); r.status != http.StatusAccepted {
			t.Fatalf("code %d: %d %v", i+1, r.status, r.body)
		}
	}
	req, err := http.NewRequest(http.MethodPost, e.srv.URL+"/v1/me/fresh-sign-in", nil)
	if err != nil {
		t.Fatal(err)
	}
	c := claims(alice)
	c["sid"], c["iat"], c["exp"] = "session-x", refreshed.Unix(), refreshed.Add(time.Hour).Unix()
	req.Header.Set("Authorization", "Bearer "+signES256(t, e.privyKey, c))
	res, err := e.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("an eleventh code: %d", res.StatusCode)
	}
	if wait, err := time.ParseDuration(res.Header.Get("Retry-After") + "s"); err != nil || wait < 59*time.Minute {
		t.Errorf("Retry-After = %q", res.Header.Get("Retry-After"))
	}
	if r := send("session-y"); errorCode(r) != "too_many_codes" {
		t.Errorf("the eleventh code's answer: %d %v", r.status, r.body)
	}
}

// R-137: a code whose email failed was never sent, so asking again sends one at once.
func TestACodeWhoseEmailFailedIsNotSent(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	e.wallets.Lock()
	e.wallets.Emails[alice] = "alice@example.com"
	e.wallets.Unlock()
	send := func() reply {
		return e.inSession(t, "POST", "/v1/me/fresh-sign-in", alice, "session-1", signedInAt.Add(2*time.Second), "")
	}
	e.codes.Lock()
	e.codes.down = true
	e.codes.Unlock()
	if r := send(); r.status != http.StatusInternalServerError {
		t.Fatalf("Resend down: %d %v", r.status, r.body)
	}
	e.codes.Lock()
	e.codes.down = false
	e.codes.Unlock()
	if r := send(); r.status != http.StatusAccepted || e.codes.count() != 1 {
		t.Fatalf("asked again: %d %v, %d emails", r.status, r.body, e.codes.count())
	}
}

// R-137: the code goes to a signed-in person's login email; an account with none, a key or no token gets none.
func TestCodesNeedASignedInPersonWithAnEmail(t *testing.T) {
	e := invoiceAPI(t)
	const alice = "did:privy:alice"
	refreshed := signedInAt.Add(2 * time.Second)
	if r := e.inSession(t, "POST", "/v1/me/fresh-sign-in", alice, "session-1", refreshed, ""); r.status !=
		http.StatusConflict || errorCode(r) != "no_login_email" {
		t.Errorf("no login email: %d %v", r.status, r.body)
	}
	made := e.call(t, "POST", "/v1/profiles/"+e.aliceProfile+"/keys", alice, "",
		`{"name": "Server", "scopes": ["invoices.read"]}`)
	key, _ := made.body["secret"].(string)
	if key == "" {
		t.Fatalf("make key: %d %v", made.status, made.body)
	}
	for _, path := range []string{"/v1/me/fresh-sign-in", "/v1/me/fresh-sign-in/verify"} {
		if r := e.withKey(t, "POST", path, key, `{"code": "123456"}`); r.status != http.StatusUnauthorized {
			t.Errorf("%s with a key: %d %v", path, r.status, r.body)
		}
		if r := e.withKey(t, "POST", path, "", `{"code": "123456"}`); r.status != http.StatusUnauthorized {
			t.Errorf("%s with no token: %d %v", path, r.status, r.body)
		}
	}
	if e.codes.count() != 0 {
		t.Errorf("%d emails sent", e.codes.count())
	}
}
