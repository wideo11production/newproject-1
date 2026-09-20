package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"newproject/services/royalty-service/src/model"
	"newproject/services/royalty-service/src/repository"
)

type RoyaltyService struct {
	tierRepo   repository.RateTierRepository
	royaltyRepo repository.RoyaltyRepository
	feeRepo    repository.PlatformFeeRepository
}

func NewRoyaltyService(
	tierRepo repository.RateTierRepository,
	royaltyRepo repository.RoyaltyRepository,
	feeRepo repository.PlatformFeeRepository,
) *RoyaltyService {
	return &RoyaltyService{
		tierRepo:    tierRepo,
		royaltyRepo: royaltyRepo,
		feeRepo:     feeRepo,
	}
}

func (s *RoyaltyService) CreateRateTier(ctx context.Context, currency model.Currency, minRevenue, maxRevenue, rate string, source model.RevenueSource, name, description string, isDefault bool) (*model.RateTier, error) {
	minRev, err := decimal.NewFromString(minRevenue)
	if err != nil {
		return nil, errors.New("invalid min_revenue")
	}
	var maxRev *decimal.Decimal
	if maxRevenue != "" && maxRevenue != "null" {
		mr, err := decimal.NewFromString(maxRevenue)
		if err != nil {
			return nil, errors.New("invalid max_revenue")
		}
		maxRev = &mr
	}
	rateDec, err := decimal.NewFromFloat(0), error(nil)
	rateDec, err = decimal.NewFromString(rate)
	if err != nil {
		return nil, errors.New("invalid rate")
	}

	tier := &model.RateTier{
		UUID:        uuid.New(),
		Currency:    currency,
		MinRevenue:  minRev,
		Rate:        rateDec,
		Source:      source,
		Name:        name,
		IsDefault:   isDefault,
		Description: description,
	}
	if maxRev != nil {
		tier.MaxRevenue = *maxRev
	}

	if isDefault {
		if err := s.clearDefaultTiers(ctx, currency); err != nil {
			return nil, err
		}
	}

	if err := s.tierRepo.Create(ctx, tier); err != nil {
		return nil, err
	}
	return tier, nil
}

func (s *RoyaltyService) clearDefaultTiers(ctx context.Context, currency model.Currency) error {
	tiers, err := s.tierRepo.GetByCurrency(ctx, currency, 100, 0)
	if err != nil {
		return err
	}
	for _, tier := range tiers {
		if tier.IsDefault {
			tier.IsDefault = false
			if err := s.tierRepo.Update(ctx, tier); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *RoyaltyService) GetRateTier(ctx context.Context, id uint) (*model.RateTier, error) {
	return s.tierRepo.GetByID(ctx, id)
}

func (s *RoyaltyService) ListRateTiers(ctx context.Context, currency model.Currency, limit, offset int) ([]*model.RateTier, error) {
	return s.tierRepo.GetByCurrency(ctx, currency, limit, offset)
}

func (s *RoyaltyService) UpdateRateTier(ctx context.Context, tier *model.RateTier) error {
	return s.tierRepo.Update(ctx, tier)
}

func (s *RoyaltyService) GetPlatformFee(ctx context.Context, currency model.Currency) (*model.PlatformFee, error) {
	return s.feeRepo.GetByCurrency(ctx, currency)
}

func (s *RoyaltyService) CreatePlatformFee(ctx context.Context, currency model.Currency, rate, minFee, maxFee string, source model.RevenueSource, description string) (*model.PlatformFee, error) {
	rateDec, err := decimal.NewFromString(rate)
	if err != nil {
		return nil, errors.New("invalid rate")
	}
	minF, err := decimal.NewFromString(minFee)
	if err != nil {
		return nil, errors.New("invalid min_fee")
	}
	maxF, err := decimal.NewFromString(maxFee)
	if err != nil {
		return nil, errors.New("invalid max_fee")
	}

	fee := &model.PlatformFee{
		UUID:        uuid.New(),
		Currency:    currency,
		Rate:        rateDec,
		MinFee:      minF,
		MaxFee:      maxF,
		Source:      source,
		Description: description,
	}
	if err := s.feeRepo.Create(ctx, fee); err != nil {
		return nil, err
	}
	return fee, nil
}

func (s *RoyaltyService) UpdatePlatformFee(ctx context.Context, fee *model.PlatformFee) error {
	return s.feeRepo.Update(ctx, fee)
}

func (s *RoyaltyService) CalculateRoyalty(ctx context.Context, userID uint, currency model.Currency, grossRevenue string, source model.RevenueSource, periodStart, periodEnd time.Time, referenceID, description string) (*model.RoyaltyRecord, error) {
	revenue, err := decimal.NewFromString(grossRevenue)
	if err != nil {
		return nil, errors.New("invalid gross revenue")
	}
	if revenue.LessThanOrEqual(decimal.Zero) {
		return nil, errors.New("revenue must be positive")
	}

	tier, err := s.tierRepo.GetByAmount(ctx, currency, revenue)
	if err != nil {
		if err == repository.ErrRateTierNotFound {
			tier, err = s.tierRepo.GetDefault(ctx, currency)
			if err != nil {
				return nil, errors.New("no default rate tier for currency")
			}
		} else {
			return nil, err
		}
	}

	platformFee, err := s.feeRepo.GetByCurrency(ctx, currency)
	if err != nil && err != repository.ErrPlatformFeeNotFound {
		return nil, err
	}

	var platformFeeAmount decimal.Decimal
	if platformFee != nil {
		platformFeeAmount := revenue.Mul(platformFee.Rate)
		if platformFee.MinFee.GreaterThan(decimal.Zero) && platformFeeAmount.LessThan(platformFee.MinFee) {
			platformFeeAmount = platformFee.MinFee
		}
		if !platformFee.MaxFee.IsZero() && platformFeeAmount.GreaterThan(platformFee.MaxFee) {
			platformFeeAmount = platformFee.MaxFee
		}
	}

	netRevenue := revenue.Sub(platformFeeAmount)
	royaltyAmount := netRevenue.Mul(tier.Rate)

	record := &model.RoyaltyRecord{
		UUID:          uuid.New(),
		UserID:        userID,
		Currency:      currency,
		PeriodStart:   periodStart,
		PeriodEnd:     periodEnd,
		GrossRevenue:  revenue,
		PlatformFee:   platformFeeAmount,
		NetRevenue:    netRevenue,
		RoyaltyRate:   tier.Rate,
		RoyaltyAmount: royaltyAmount,
		Status:        model.RoyaltyStatusCalculated,
		Source:        source,
		ReferenceID:   referenceID,
		Description:   description,
	}

	if err := s.royaltyRepo.Create(ctx, record); err != nil {
		return nil, err
	}

	return record, nil
}

func (s *RoyaltyService) GetRoyaltyRecord(ctx context.Context, id uint) (*model.RoyaltyRecord, error) {
	return s.royaltyRepo.GetByID(ctx, id)
}

func (s *RoyaltyService) GetRoyaltyRecordByUUID(ctx context.Context, uuid string) (*model.RoyaltyRecord, error) {
	return s.royaltyRepo.GetByUUID(ctx, uuid)
}

func (s *RoyaltyService) ListRoyaltyRecords(ctx context.Context, userID uint, limit, offset int) ([]*model.RoyaltyRecord, error) {
	return s.royaltyRepo.GetByUserID(ctx, userID, limit, offset)
}

func (s *RoyaltyService) GetRoyaltiesByPeriod(ctx context.Context, userID uint, start, end time.Time) ([]*model.RoyaltyRecord, error) {
	return s.royaltyRepo.GetByPeriod(ctx, userID, start, end)
}

func (s *RoyaltyService) GetPendingRoyalties(ctx context.Context, limit int) ([]*model.RoyaltyRecord, error) {
	return s.royaltyRepo.GetByStatus(ctx, model.RoyaltyStatusPending, limit)
}

func (s *RoyaltyService) MarkAsPaid(ctx context.Context, recordID uint) (*model.RoyaltyRecord, error) {
	record, err := s.royaltyRepo.GetByID(ctx, recordID)
	if err != nil {
		return nil, err
	}

	if record.Status != model.RoyaltyStatusCalculated {
		return nil, errors.New("royalty is not in calculated status")
	}

	now := time.Now()
	record.Status = model.RoyaltyStatusPaid
	record.PaidAt = &now
	if err := s.royaltyRepo.Update(ctx, record); err != nil {
		return nil, err
	}

	return record, nil
}

func (s *RoyaltyService) SumRoyaltiesByPeriod(ctx context.Context, userID uint, start, end time.Time) (decimal.Decimal, error) {
	records, err := s.royaltyRepo.GetByPeriod(ctx, userID, start, end)
	if err != nil {
		return decimal.Zero, err
	}

	var total decimal.Decimal
	for _, record := range records {
		total = total.Add(record.RoyaltyAmount)
	}
	return total, nil
}
