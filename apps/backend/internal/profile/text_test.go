package profile

import "testing"

func TestPlainText(t *testing.T) {
	for s, ok := range map[string]bool{"Mara Ilić": true, "日本語": true, "a​b": false, "‮troppus": false,
		"a\tb": false, "a\nb": false, "a\u2028b": false, "\u3164": false, "\u2800x": false, "خانه\u200cها": true} {
		if PlainText(s, false) != ok {
			t.Errorf("PlainText(%q) = %v", s, !ok)
		}
	}
	if !PlainText("1 Test Street\nBerlin", true) || PlainText("x\r\ny", true) {
		t.Error("lines: a line break is allowed, a carriage return is not")
	}
}

func TestImpersonates(t *testing.T) {
	for _, name := range []string{"Forwend", "forwend support", "For wend", "Forwеnd" /* Cyrillic е */, "Fórwend",
		"F0rwend", "FORWEND Security Team", "𝐅𝐨𝐫𝐰𝐞𝐧𝐝", "ℱorwend", "FORWΕND", "FORWEΝD", "Ｆｏｒｗｅｎｄ",
		"ꜰᴏʀᴡᴇɴᴅ" /* small capitals */, "ꓝꓳꓣꓪꓰꓠꓓ" /* Lisu */, "ꓝORWEND Support", "Forvvend Support", "F o r w e n d",
		// Unicode's confusables (UTS #39) cover other scripts too (audit 2026-10-19).
		"Fօrwend Billing" /* Armenian օ */, "Forweոd" /* Armenian ո */, "Forwenԁ" /* Cyrillic ԁ */, "ϜORWEND",
		"Fᴏrwend", "ƑORWEND", "FORWENԀ", "FORѠEND", "FORWEПD", "FORWEՈD", /* upper case whose lower case reads as a letter */
		"For|wend" /* a bar as a gap */, "Forw℮nd", "F〇rwend", "Fంrwend" /* symbols and marks as letters */} {
		if !Impersonates(name) {
			t.Errorf("%q passes", name)
		}
	}
	for _, name := range []string{"Kettle & Co.", "Forward End", "Brightline Studio", "Gifts for Wendy",
		"For Wendy's Bakery"} {
		if Impersonates(name) {
			t.Errorf("%q refused", name)
		}
	}
}
