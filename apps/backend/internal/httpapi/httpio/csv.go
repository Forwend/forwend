package httpio

import (
	"regexp"
	"strings"
)

var formulaAfterSemicolon = regexp.MustCompile(`;("*[=+\-@\t\r])`)

// CSVText protects untrusted text, including spreadsheets configured with semicolon separators.
func CSVText(value string) string {
	if value != "" && strings.ContainsRune("=+-@\t\r", rune(value[0])) {
		value = "'" + value
	}
	if strings.Contains(value, ";") {
		value = formulaAfterSemicolon.ReplaceAllString(value, ";'$1")
	}
	return value
}
