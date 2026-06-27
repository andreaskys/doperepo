package venues

import (
	"context"
	"encoding/json"
	"log"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

const (
	publicListCacheKey = "venues:public:list"
	publicListTTL      = 5 * time.Minute
)

// cachedPublicList devolve a listagem cacheada. Miss/erro → (nil, false).
func (s *Service) cachedPublicList(ctx context.Context) ([]PublicVenue, bool) {
	if s.redis == nil {
		return nil, false
	}
	data, err := s.redis.Get(ctx, publicListCacheKey).Bytes()
	if err != nil {
		if err != goredis.Nil {
			log.Printf("cache get: %v", err)
		}
		return nil, false
	}
	var list []PublicVenue
	if err := json.Unmarshal(data, &list); err != nil {
		log.Printf("cache unmarshal: %v", err)
		return nil, false
	}
	return list, true
}

// cachePublicList grava a listagem com TTL (best-effort).
func (s *Service) cachePublicList(ctx context.Context, list []PublicVenue) {
	if s.redis == nil {
		return
	}
	data, err := json.Marshal(list)
	if err != nil {
		log.Printf("cache marshal: %v", err)
		return
	}
	if err := s.redis.Set(ctx, publicListCacheKey, data, publicListTTL).Err(); err != nil {
		log.Printf("cache set: %v", err)
	}
}

// invalidatePublicList apaga a chave (best-effort).
func (s *Service) invalidatePublicList(ctx context.Context) {
	if s.redis == nil {
		return
	}
	if err := s.redis.Del(ctx, publicListCacheKey).Err(); err != nil {
		log.Printf("cache del: %v", err)
	}
}
