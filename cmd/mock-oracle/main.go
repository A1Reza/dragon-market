package main

import (
	"encoding/json"
	"hash/fnv"
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	http.HandleFunc("/prices/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/prices/")
		if id == "" {
			http.Error(w, "item ID is required", http.StatusBadRequest)
			return
		}
		h := fnv.New64a()
		_, _ = h.Write([]byte(id))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]uint64{"base_price": 100 + h.Sum64()%9901})
	})
	address := os.Getenv("ORACLE_HTTP_ADDR")
	if address == "" {
		address = "127.0.0.1:8090"
	}
	log.Printf("mock price oracle listening on %s", address)
	log.Fatal(http.ListenAndServe(address, nil))
}
