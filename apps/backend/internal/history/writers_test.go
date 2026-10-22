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

func TestInvoiceWritersKeepHistory(t *testing.T) {
	writes := regexp.MustCompile(`(?i)\b(?:INSERT\s+INTO|UPDATE(?:\s+ONLY)?)\s+(?:"?public"?\.)?"?invoices"?(?:\s|\(|$)` +
		`|Identifier\{"invoices"\}`)
	writers := 0
	err := filepath.WalkDir("../..", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == "node_modules" {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		n := len(writes.FindAll(src, -1))
		if n == 0 {
			return nil
		}
		writers++
		if adds := bytes.Count(src, []byte("history.Add(")); adds < n {
			t.Errorf("%s writes invoices %d times but calls history.Add %d times", path, n, adds)
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
