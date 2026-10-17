package guild

import (
	"context"
	"errors"
	"fmt"
	"market-dragon/internal/gold"
	"math"
	"strings"
	"time"
)

type Transactor interface {
	RunInTransaction(
		ctx context.Context,
		fn func(context.Context) error,
	) error
}

type WalletServiceImpl struct {
	guildRepository GuildRepository
	tx              Transactor
	now             func() time.Time
}

type transactionRecorder interface {
	RecordWalletTransaction(ctx context.Context, guildID, operation string, amount gold.Amount, state *Guild) error
}

type guildCreator interface {
	Create(ctx context.Context, guild *Guild) error
}

func (s *WalletServiceImpl) CreateGuild(ctx context.Context, id string, initialGold, dailyLimit gold.Amount) (*Guild, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("%w: ID is required", ErrInvalidGuild)
	}
	if initialGold < 0 {
		return nil, fmt.Errorf("%w: initial gold cannot be negative", ErrInvalidGuild)
	}
	if dailyLimit < 0 {
		return nil, fmt.Errorf("%w: daily limit cannot be negative", ErrInvalidGuild)
	}
	creator, ok := s.guildRepository.(guildCreator)
	if !ok {
		return nil, errors.New("guild repository does not support creation")
	}
	g := &Guild{
		ID: id, Gold: initialGold, DailyLimit: dailyLimit,
		SpentOn: s.now().UTC().Truncate(24 * time.Hour),
	}
	if err := creator.Create(ctx, g); err != nil {
		return nil, err
	}
	return g, nil
}

type WalletOption func(*WalletServiceImpl)

func WithClock(now func() time.Time) WalletOption {
	return func(s *WalletServiceImpl) { s.now = now }
}

func NewWalletService(r GuildRepository, tx Transactor, options ...WalletOption) *WalletServiceImpl {
	s := &WalletServiceImpl{guildRepository: r, tx: tx, now: time.Now}
	for _, option := range options {
		option(s)
	}
	return s
}

func (s *WalletServiceImpl) resetDailySpend(g *Guild) {
	today := s.now().UTC().Truncate(24 * time.Hour)
	if g.SpentOn.IsZero() {
		g.SpentOn = today
		return
	}
	if g.SpentOn.UTC().Truncate(24*time.Hour) != today {
		g.DailySpent = 0
		g.SpentOn = today
	}
}

func (s *WalletServiceImpl) save(ctx context.Context, g *Guild, operation string, amount gold.Amount) error {
	if err := s.guildRepository.Update(ctx, g); err != nil {
		return err
	}
	if recorder, ok := s.guildRepository.(transactionRecorder); ok {
		return recorder.RecordWalletTransaction(ctx, g.ID, operation, amount, g)
	}
	return nil
}

// All holds consume capacity on every day until released or settled. Subtract
// from the limit rather than adding amounts that could overflow int64.
func checkDailyCapacity(g *Guild, amount gold.Amount) error {
	if g.DailyLimit > 0 && (g.DailySpent > g.DailyLimit ||
		g.Reserved > g.DailyLimit-g.DailySpent ||
		amount > g.DailyLimit-g.DailySpent-g.Reserved) {
		return ErrDailyLimitReached
	}
	return nil
}

func (s *WalletServiceImpl) Reserve(ctx context.Context, id string, amount gold.Amount) error {
	if amount <= 0 {
		return ErrInvalidAmount
	}
	return s.tx.RunInTransaction(ctx, func(ctx context.Context) error {
		repo := s.guildRepository
		g, err := repo.Get(ctx, id)
		if errors.Is(err, ErrGuildNotFound) {
			return fmt.Errorf("guild %s does not exist: %w", id, err)
		}
		if err != nil {
			return err
		}
		s.resetDailySpend(g)

		available := g.Gold - g.Reserved
		if available < amount {
			return fmt.Errorf("%w: available %v, requested %v", ErrInsufficientBalance, available, amount)
		}
		if err := checkDailyCapacity(g, amount); err != nil {
			return err
		}
		g.Reserved += amount
		return s.save(ctx, g, "reserve", amount)
	})
}

func (s *WalletServiceImpl) Deduct(ctx context.Context, id string, amount gold.Amount) error {
	if amount <= 0 {
		return ErrInvalidAmount
	}
	return s.tx.RunInTransaction(ctx, func(ctx context.Context) error {
		repo := s.guildRepository
		g, err := repo.Get(ctx, id)
		if errors.Is(err, ErrGuildNotFound) {
			return fmt.Errorf("guild %s does not exist: %w", id, err)
		}
		if err != nil {
			return err
		}
		s.resetDailySpend(g)

		if amount > g.Reserved {
			return ErrInsufficientReserve
		}
		if amount > g.Gold {
			return ErrInsufficientBalance
		}
		if g.DailySpent > math.MaxInt64-amount {
			return ErrAmountOverflow
		}
		// Settlement exchanges an existing hold for completed spending. Total
		// daily usage stays constant, including for holds from previous days.
		g.DailySpent += amount
		g.Reserved -= amount
		g.Gold -= amount
		return s.save(ctx, g, "deduct", amount)
	})
}

func (s *WalletServiceImpl) Release(ctx context.Context, id string, amount gold.Amount) error {
	if amount <= 0 {
		return ErrInvalidAmount
	}
	return s.tx.RunInTransaction(ctx, func(ctx context.Context) error {
		repo := s.guildRepository
		g, err := repo.Get(ctx, id)
		if errors.Is(err, ErrGuildNotFound) {
			return fmt.Errorf("guild %s does not exist: %w", id, err)
		}
		if err != nil {
			return err
		}
		s.resetDailySpend(g)

		enoughReserve := g.Reserved >= amount
		if !enoughReserve {
			return fmt.Errorf("%w: have %v, need %v", ErrInsufficientReserve, g.Reserved, amount)
		}

		g.Reserved -= amount
		return s.save(ctx, g, "release", amount)
	})
}

func (s *WalletServiceImpl) Earn(ctx context.Context, id string, amount gold.Amount) error {
	if amount <= 0 {
		return ErrInvalidAmount
	}
	return s.tx.RunInTransaction(ctx, func(ctx context.Context) error {
		repo := s.guildRepository
		g, err := repo.Get(ctx, id)
		if errors.Is(err, ErrGuildNotFound) {
			return fmt.Errorf("guild %s does not exist: %w", id, err)
		}
		if err != nil {
			return err
		}
		s.resetDailySpend(g)

		if g.Gold > math.MaxInt64-amount {
			return ErrAmountOverflow
		}
		g.Gold += amount
		return s.save(ctx, g, "earn", amount)
	})
}

func (s *WalletServiceImpl) Spend(ctx context.Context, id string, amount gold.Amount) error {
	if amount <= 0 {
		return ErrInvalidAmount
	}
	return s.tx.RunInTransaction(ctx, func(ctx context.Context) error {
		repo := s.guildRepository
		g, err := repo.Get(ctx, id)
		if errors.Is(err, ErrGuildNotFound) {
			return fmt.Errorf("guild %s does not exist: %w", id, err)
		}
		if err != nil {
			return err
		}
		s.resetDailySpend(g)

		available := g.Gold - g.Reserved
		if available < amount {
			return fmt.Errorf("%w: have %v, need %v", ErrInsufficientBalance, available, amount)
		}
		if err := checkDailyCapacity(g, amount); err != nil {
			return err
		}
		if g.DailySpent > math.MaxInt64-amount {
			return ErrAmountOverflow
		}

		g.DailySpent += amount
		g.Gold -= amount
		return s.save(ctx, g, "spend", amount)
	})
}

func (s *WalletServiceImpl) GetGuild(ctx context.Context, id string) (*Guild, error) {
	g, err := s.guildRepository.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	// Project a stale persisted day for wallet reads without mutating storage.
	current := *g
	s.resetDailySpend(&current)
	return &current, nil
}
