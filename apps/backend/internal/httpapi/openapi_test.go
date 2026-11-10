package httpapi_test

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/forwend/forwend/apps/backend/internal/invoice"
)

// R-150, D-100: openapi.yaml is written by hand, so this keeps it to the routes: each route has its operation, and
// each operation its route. Path parameters match by place, not name. A route must be written so this test can read
// it: one literal "METHOD /path" on its Handle line.
func TestOpenAPINamesEveryRoute(t *testing.T) {
	param := regexp.MustCompile(`\{\w+\}`)
	call := regexp.MustCompile(`\.Handle(?:Func)?\(`)
	literal := regexp.MustCompile(`\.Handle(?:Func)?\("(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (/[^" ]*)"`)
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	modules, err := filepath.Glob("*/*.go")
	if err != nil {
		t.Fatal(err)
	}
	routes := map[string]bool{}
	for _, file := range append(files, modules...) {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			if !call.MatchString(line) {
				continue
			}
			m := literal.FindStringSubmatch(line)
			if m == nil || len(call.FindAllString(line, -1)) > 1 {
				t.Errorf(`%s:%d: write the route as one literal "METHOD /path" on its Handle line`, file, i+1)
				continue
			}
			routes[m[1]+" "+param.ReplaceAllString(m[2], "{}")] = true
		}
	}
	if len(routes) == 0 {
		t.Fatal("no routes read")
	}
	delete(routes, "GET /healthz") // the load balancer's, not the API's (docs/backend/api.md)

	spec, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	pathLine := regexp.MustCompile(`^  (/\S*):$`)
	methodLine := regexp.MustCompile(`^    (get|head|post|put|patch|delete|options|trace):`)
	operations := map[string]bool{}
	inPaths, path := false, ""
	for i, line := range strings.Split(string(spec), "\n") {
		switch {
		case line != "" && line[0] != ' ':
			inPaths = line == "paths:"
		case !inPaths:
		case strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "   "):
			m := pathLine.FindStringSubmatch(line)
			if m == nil {
				t.Errorf("openapi.yaml:%d: write a path as a plain `/path:` line", i+1)
				path = ""
				continue
			}
			path = param.ReplaceAllString(m[1], "{}")
		default:
			if m := methodLine.FindStringSubmatch(line); m != nil && path != "" {
				operations[strings.ToUpper(m[1])+" "+path] = true
			}
		}
	}
	if len(operations) == 0 {
		t.Fatal("no operations read from openapi.yaml")
	}
	for route := range routes {
		if !operations[route] {
			t.Errorf("%s has no operation in openapi.yaml", route)
		}
	}
	for operation := range operations {
		if !routes[operation] {
			t.Errorf("openapi.yaml's %s has no route", operation)
		}
	}
}

// The spec's Error.code enum is the codes the API writes: through httpio.WriteError, or a module's own error body.
func TestOpenAPIErrorCodesMatchTheAPI(t *testing.T) {
	files, err := filepath.Glob("*/*.go")
	if err != nil {
		t.Fatal(err)
	}
	written := regexp.MustCompile(`(?:http\.Status\w+, |"code": )"([a-z_]+)"`)
	var api []string
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range written.FindAllStringSubmatch(string(src), -1) {
			api = append(api, m[1])
		}
	}
	spec, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	enum := regexp.MustCompile(`required: \[code, message\]\s+properties:\s+code:\s+type: string\s+enum: \[([^\]]*)\]`).
		FindSubmatch(spec)
	if enum == nil {
		t.Fatal("no Error.code enum read from openapi.yaml")
	}
	var codes []string
	for code := range strings.SplitSeq(string(enum[1]), ",") {
		codes = append(codes, strings.TrimSpace(code))
	}
	if len(api) == 0 {
		t.Fatal("no error codes read from the API")
	}
	for _, code := range api {
		if !slices.Contains(codes, code) {
			t.Errorf("the API writes %s, missing from openapi.yaml's Error.code enum", code)
		}
	}
	for _, code := range codes {
		if !slices.Contains(api, code) {
			t.Errorf("openapi.yaml's Error.code enum has %s, which the API never writes", code)
		}
	}
}

// D-114: the spec's state and wallet enums, on the filters and on Payment, are the values the API filters and returns.
func TestOpenAPIPaymentStatesMatchTheAPI(t *testing.T) {
	spec, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	enums := regexp.MustCompile(`enum: \[([^\]]*)\]`).FindAllStringSubmatch(string(spec), -1)
	for _, want := range [][]string{invoice.PaymentStates, invoice.WalletStates} {
		found := 0
		for _, enum := range enums {
			if got := strings.Split(enum[1], ", "); got[0] == want[0] && slices.Contains(got, want[2]) {
				found++
				if !slices.Equal(got, want) {
					t.Errorf("openapi.yaml has %v, the API %v", got, want)
				}
			}
		}
		if found != 2 {
			t.Errorf("openapi.yaml has %d enums like %v, want the filter's and Payment's", found, want)
		}
	}
}
