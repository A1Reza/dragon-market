// Package review is an optional access gateway for temporary human review.
// It does not provide marketplace authorization or change domain semantics.
package review

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strings"
)

const Baseline = "8f31a33ecb6c94c7d26a26a2a6f617772ba27816"

type Config struct {
	Username, Password, Commit string
	Assets                     fs.FS
	Backend                    *url.URL
	Transport                  http.RoundTripper
}

func Handler(c Config) (http.Handler, error) {
	if c.Username == "" || strings.Contains(c.Username, ":") || len(c.Password) < 24 {
		return nil, errors.New("review username and a password of at least 24 bytes are required")
	}
	if c.Backend == nil || c.Backend.Scheme != "http" || c.Backend.Host != "127.0.0.1:8080" {
		return nil, errors.New("review backend must be http://127.0.0.1:8080")
	}
	if c.Assets == nil {
		return nil, errors.New("review assets are required")
	}
	userHash, passHash := sha256.Sum256([]byte(c.Username)), sha256.Sum256([]byte(c.Password))
	proxy := httputil.NewSingleHostReverseProxy(c.Backend)
	proxy.Transport = c.Transport
	previous := proxy.Director
	proxy.Director = func(r *http.Request) {
		previous(r)
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")
		r.URL.RawPath = ""
		r.Header.Del("Authorization")
		r.Header.Del("Cookie")
		r.Header.Del("Forwarded")
		r.Header.Del("X-Forwarded-For")
		r.Header.Del("X-Forwarded-Host")
	}
	static := http.FileServer(http.FS(c.Assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
		if r.URL.Path == "/healthz" && (r.Method == "GET" || r.Method == "HEAD") {
			// Process availability only. No database or revision details are public.
			w.WriteHeader(http.StatusOK)
			return
		}
		u, p, ok := r.BasicAuth()
		uh, ph := sha256.Sum256([]byte(u)), sha256.Sum256([]byte(p))
		valid := subtle.ConstantTimeCompare(uh[:], userHash[:]) & subtle.ConstantTimeCompare(ph[:], passHash[:])
		if !ok || valid != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="Dragon Market human review", charset="UTF-8"`)
			http.Error(w, "Reviewer access required", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Cross-site access is disabled", http.StatusForbidden)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			origin, err := url.Parse(r.Header.Get("Origin"))
			if err != nil || origin.Host != r.Host || origin.Host == "" || (origin.Scheme != "https" && origin.Scheme != "http") || origin.Path != "" || origin.User != nil {
				http.Error(w, "Mutation requires same-origin request", http.StatusForbidden)
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		if r.URL.Path == "/review/config" && r.Method == "GET" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"environment": "temporary-human-review", "commit": c.Commit, "implementation_baseline": Baseline, "approval": "PENDING_HUMAN_REVIEW", "isolated_runner": false, "known_issue": "WAL-03 / KNOWN-01: prior-day reservation release can bypass today's daily limit"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			p := strings.TrimPrefix(r.URL.Path, "/api")
			allowed := p == "/healthz" || p == "/dev/snapshot"
			for _, root := range []string{"/guilds", "/items", "/orders", "/auctions", "/bids"} {
				allowed = allowed || p == root || strings.HasPrefix(p, root+"/")
			}
			if !allowed || path.Clean(p) != p || strings.Contains(p, "\\") {
				http.NotFound(w, r)
				return
			}
			proxy.ServeHTTP(w, r)
			return
		}
		// No SPA fallback for unknown paths: hash navigation needs none.
		if r.Method != "GET" && r.Method != "HEAD" {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if !fs.ValidPath(name) || strings.Contains(name, "\\") {
			http.NotFound(w, r)
			return
		}
		info, err := fs.Stat(c.Assets, name)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		static.ServeHTTP(w, r)
	}), nil
}
