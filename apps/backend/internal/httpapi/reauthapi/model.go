package reauthapi

type codeBody struct {
	Code string `json:"code"`
}

type twoStepBody struct {
	Methods []string `json:"methods"`
}
