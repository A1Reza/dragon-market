package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"market-dragon/internal/idempotency"
	"market-dragon/internal/oracle"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"market-dragon/internal/api"
	"market-dragon/internal/auction"
	"market-dragon/internal/guild"
	"market-dragon/internal/item"
	"market-dragon/internal/order"
	"market-dragon/internal/postgres"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://market:market@localhost:5432/market?sslmode=disable"
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := db.PingContext(pingCtx); err != nil {
		return err
	}

	guildRepo := postgres.NewWalletRepository(db)
	itemRepo := postgres.NewItemRepository(db)
	orderRepo := postgres.NewOrderRepository(db)
	auctionRepo := postgres.NewAuctionRepository(db)

	tx := postgres.NewTransactor(db)

	walletSvc := guild.NewWalletService(guildRepo, tx)
	itemSvc := item.NewItemService(itemRepo, guildRepo)
	orderSvc := order.NewOrderService(
		orderRepo,
		walletSvc,
		itemSvc,
		tx,
	)
	auctionSvc := auction.NewAuctionService(
		auctionRepo,
		walletSvc,
		itemSvc,
		tx,
	)
	go auction.RunSettlementWorker(ctx, auctionSvc, time.Minute)

	idemRepo := postgres.NewIdempotencyRepo(db)
	idemSvc := idempotency.NewService(idemRepo, tx)

	if oracleURL := os.Getenv("PRICE_ORACLE_URL"); oracleURL != "" {
		client, err := oracle.NewHTTPOracle(oracleURL, nil)
		if err != nil {
			return err
		}
		priceUpdater := oracle.NewUpdater(
			oracle.NewResilientOracle(client),
			itemRepo,
			30*time.Second,
			func(err error) { slog.Warn("price oracle refresh failed", "error", err) },
		)
		go priceUpdater.Run(ctx)
	}

	handler := api.NewRouter(
		walletSvc,
		itemSvc,
		auctionSvc,
		orderSvc,
		idemSvc,
	)
	address := os.Getenv("HTTP_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}
	if os.Getenv("APP_ENV") == "development" {
		commit := "unavailable"
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, setting := range info.Settings {
				if setting.Key == "vcs.revision" {
					commit = setting.Value
				}
			}
		}
		handler = api.WithDevelopmentInspection(handler, postgres.NewInspector(db, commit))
	}

	server := &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("server started", "address", server.Addr)
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err

	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(
			context.Background(),
			10*time.Second,
		)
		defer cancel()

		return server.Shutdown(shutdownCtx)
	}
}
