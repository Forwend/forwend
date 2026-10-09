package database_test

import (
	"context"
	"testing"

	"github.com/ensp1re/forwend/apps/backend/internal/database"
	"github.com/ensp1re/forwend/apps/backend/internal/database/databasetest"
)

func TestMigrateTwiceOnEmptyDatabase(t *testing.T) {
	url := databasetest.New(t)
	for i := range 2 {
		if err := database.Migrate(context.Background(), url); err != nil {
			t.Fatalf("run %d: %v", i+1, err)
		}
	}
}
