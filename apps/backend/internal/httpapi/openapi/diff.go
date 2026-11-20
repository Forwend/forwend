// Package openapi holds the request and response types generated from api/openapi.yaml.
package openapi

import (
	"encoding/json"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"
	"time"
)

type jsonField struct {
	typ       reflect.Type
	omitEmpty bool
}

var (
	rawMessage = reflect.TypeFor[json.RawMessage]()
	timeType   = reflect.TypeFor[time.Time]()
)

// Diff lists how hand's JSON differs from spec's; loose names omitempty fields the route always sets.
func Diff(spec, hand any, answer bool, loose ...string) []string {
	var out []string
	diff(&out, "", reflect.TypeOf(spec), reflect.TypeOf(hand), answer, loose)
	return out
}

func diff(out *[]string, path string, spec, hand reflect.Type, answer bool, loose []string) {
	spec, hand = deref(spec), deref(hand)
	if hand == rawMessage || spec.Kind() == reflect.Interface || hand.Kind() == reflect.Interface {
		return
	}
	if !answer && spec.Kind() == reflect.Struct && hand.Kind() == reflect.Map {
		for name, f := range fields(spec) {
			diff(out, path+"."+name, f.typ, hand.Elem(), answer, loose)
		}
		return
	}
	if kind(spec) != kind(hand) {
		*out = append(*out, fmt.Sprintf("%s: spec %s, Go %s", path, spec, hand))
		return
	}
	switch spec.Kind() {
	case reflect.Slice, reflect.Map:
		diff(out, path+"[]", spec.Elem(), hand.Elem(), answer, loose)
	case reflect.Struct:
		sf, hf := fields(spec), fields(hand)
		names := append(slices.Collect(maps.Keys(sf)), slices.Collect(maps.Keys(hf))...)
		slices.Sort(names)
		for _, name := range slices.Compact(names) {
			at := strings.TrimPrefix(path+"."+name, ".")
			s, inSpec := sf[name]
			h, inGo := hf[name]
			switch {
			case !inGo:
				*out = append(*out, at+": only in the spec")
				continue
			case !inSpec:
				if !(answer && h.omitEmpty && slices.Contains(loose, at)) {
					*out = append(*out, at+": only in Go")
				}
				continue
			}
			if answer && !slices.Contains(loose, at) {
				if s.omitEmpty != h.omitEmpty {
					*out = append(*out, fmt.Sprintf("%s: optional in spec %t, in Go %t", at, s.omitEmpty, h.omitEmpty))
				}
				if nullable(s) != nullable(h) && !container(s.typ) && !container(h.typ) {
					*out = append(*out, fmt.Sprintf("%s: nullable in spec %t, in Go %t", at, nullable(s), nullable(h)))
				}
			}
			diff(out, at, s.typ, h.typ, answer, loose)
		}
	}
}

func fields(t reflect.Type) map[string]jsonField {
	out := map[string]jsonField{}
	var embedded []reflect.Type
	for i := range t.NumField() {
		f := t.Field(i)
		name, opts, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "-" {
			continue
		}
		if f.Anonymous && name == "" {
			embedded = append(embedded, deref(f.Type))
			continue
		}
		if !f.IsExported() {
			continue
		}
		if name == "" {
			name = f.Name
		}
		out[name] = jsonField{f.Type, strings.Contains(opts, "omitempty") || strings.Contains(opts, "omitzero")}
	}
	// encoding/json lets a struct's own field hide an embedded one of the same name.
	for _, e := range embedded {
		for name, f := range fields(e) {
			if _, ok := out[name]; !ok {
				out[name] = f
			}
		}
	}
	return out
}

func nullable(f jsonField) bool {
	return (f.typ.Kind() == reflect.Pointer || f.typ == rawMessage) && !f.omitEmpty
}

// A nil slice or map is sent as null, so either side may be nullable.
func container(t reflect.Type) bool {
	k := deref(t).Kind()
	return t != rawMessage && (k == reflect.Slice || k == reflect.Map)
}

func deref(t reflect.Type) reflect.Type {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	return t
}

func kind(t reflect.Type) string {
	if t == timeType {
		return "string"
	}
	switch t.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "integer"
	case reflect.Float32, reflect.Float64:
		return "number"
	}
	return t.Kind().String()
}
