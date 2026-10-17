package guild

import (
	"market-dragon/internal/gold"
	"time"
)

type Guild struct {
	ID         string
	Gold       gold.Amount
	Reserved   gold.Amount
	DailyLimit gold.Amount // cap on completed spending today plus all outstanding holds; zero is unlimited
	DailySpent gold.Amount // completed debits on SpentOn; excludes outstanding reservations
	SpentOn    time.Time   // UTC calendar day represented by DailySpent
}
