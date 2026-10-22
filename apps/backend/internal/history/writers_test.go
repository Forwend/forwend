package history

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Every Go file that writes the invoices table also writes history (D-92): a new writer without it fails here.
func TestInvoiceWritersKeepHistory(t *testing.T) {
	writes := regexp.MustCompile(`(?i)\b(INSERT\s+INTO|UPDATE)\s+invoices\b`)
	writers := 0
	err := filepath.WalkDir("..", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil || !writes.Match(src) {
			return err
		}
		writers++
		if !bytes.Contains(src, []byte("history.Add(")) {
			t.Errorf("%s writes invoices without history.Add", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if writers == 0 {
		t.Fatal("found no invoice writers: the scan looks in the wrong place")
	}
}
