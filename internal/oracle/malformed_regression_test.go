package oracle

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPOracleRejectsTrailingPayload(t *testing.T) {
	for _, body := range []string{`{"base_price":100} garbage`, `{"base_price":100} {"base_price":0}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer server.Close()
			source, err := NewHTTPOracle(server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := source.GetBasePrice(context.Background(), "wand"); err == nil {
				t.Fatal("malformed trailing payload accepted as a valid price")
			}
		})
	}
}
