import { Pool } from 'pg';
import { logger } from '@config/logger';
import { ReputationService } from '@modules/agents/reputation.service';
import { LeaderboardService } from '@modules/agents/leaderboard.service';

/**
 * Background job for periodic reputation recalculation and leaderboard cache warming
 */
export class ReputationJobService {
  private reputationService: ReputationService;
  private leaderboardService: LeaderboardService;
  private isRunning = false;

  constructor(private pool: Pool) {
    this.reputationService = new ReputationService(pool);
    this.leaderboardService = new LeaderboardService(pool);
  }

  /**
   * Start the periodic reputation recalculation job
   * Runs every 6 hours by default
   */
  start(intervalHours: number = 6): void {
    const intervalMs = intervalHours * 60 * 60 * 1000;

    logger.info('Starting reputation recalculation job', {
      intervalHours,
      nextRun: new Date(Date.now() + intervalMs).toISOString(),
    });

    // Run immediately on start
    this.runJob().catch((err) => {
      logger.error('Failed to run initial reputation job', { error: err });
    });

    // Schedule periodic runs
    setInterval(() => {
      this.runJob().catch((err) => {
        logger.error('Failed to run scheduled reputation job', { error: err });
      });
    }, intervalMs);
  }

  /**
   * Run the reputation recalculation and cache warming job
   */
  private async runJob(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Reputation job already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting reputation recalculation job');

      // Step 1: Detect potential fraud
      const suspiciousAgents = await this.reputationService.detectReputationFraud();
      if (suspiciousAgents.length > 0) {
        logger.warn('Detected suspicious agents', {
          count: suspiciousAgents.length,
          agents: suspiciousAgents,
        });
      }

      // Step 2: Recalculate all reputations
      const updatedCount = await this.reputationService.recalculateAllReputations();
      logger.info('Reputation recalculation completed', {
        updatedCount,
        durationMs: Date.now() - startTime,
      });

      // Step 3: Warm up leaderboard cache
      await this.leaderboardService.warmCache();
      logger.info('Leaderboard cache warmed', {
        durationMs: Date.now() - startTime,
      });

      logger.info('Reputation job completed successfully', {
        totalDurationMs: Date.now() - startTime,
        updatedAgents: updatedCount,
      });
    } catch (error) {
      logger.error('Reputation job failed', {
        error,
        durationMs: Date.now() - startTime,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manually trigger the job (useful for testing or admin operations)
   */
  async triggerManually(): Promise<void> {
    logger.info('Manually triggering reputation job');
    await this.runJob();
  }
}
