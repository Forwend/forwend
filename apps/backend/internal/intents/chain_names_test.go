package intents

import (
	"maps"
	"os"
	"regexp"
	"testing"
)

// The web names 1Click's chains as the receipt, emails and export do (R-239).
func TestChainNamesMatchTheWeb(t *testing.T) {
	src, err := os.ReadFile("../../../web/src/shared/constants/chains.ts")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)BLOCKCHAIN_NAMES: Record<string, string> = \{(.*?)\n\};`).FindSubmatch(src)
	if block == nil {
		t.Fatal("no BLOCKCHAIN_NAMES in apps/web/src/shared/constants/chains.ts")
	}
	web := map[string]string{}
	for _, m := range regexp.MustCompile(`(\w+): "([^"]+)"`).FindAllSubmatch(block[1], -1) {
		web[string(m[1])] = string(m[2])
	}
	if !maps.Equal(web, chainNames) {
		t.Errorf("chainNames differ from BLOCKCHAIN_NAMES in apps/web/src/shared/constants/chains.ts:\n%v\n%v", chainNames, web)
	}
}
