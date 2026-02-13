/**
 * Memory Service
 * Main service for Agent memory management with vector database integration
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@config/logger';
import { env } from '@config/env';
import { NotFoundError } from '@shared/middleware/error.middleware';
import { embeddingService } from './embedding.service';
import { vectorStoreService } from './vector-store.service';
import {
  AgentMemory,
  CreateMemoryInput,
  MemoryQuery,
  MemorySearchResult,
  MemoryStats,
  MemoryCleanupConfig,
} from './memory.types';

export class MemoryService {
  private pool: Pool;
  private isVectorEnabled: boolean;
  private readonly HEAT_SCORE_MULTIPLIER = 1.1; // Growth rate for heat score on access

  constructor(pool: Pool) {
    this.pool = pool;
    this.isVectorEnabled =
      embeddingService.isServiceEnabled() && vectorStoreService.isServiceEnabled();

    if (this.isVectorEnabled) {
      logger.info('Memory service initialized with vector database');
      vectorStoreService.initialize().catch((err) => {
        logger.error('Failed to initialize vector store', { error: err });
        this.isVectorEnabled = false;
      });
    } else {
      logger.warn('Memory service running without vector database');
    }
  }

  /**
   * Create a new memory for an agent
   */
  async createMemory(input: CreateMemoryInput): Promise<AgentMemory> {
    const memoryId = uuidv4();
    const now = new Date();

    // Generate embedding if enabled
    let embedding: number[] | undefined;
    if (this.isVectorEnabled) {
      try {
        embedding = await embeddingService.generateEmbedding(input.content);
      } catch (error) {
        logger.warn('Failed to generate embedding, continuing without vector', { error });
      }
    }

    // Calculate initial heat score based on content length and context
    const initialHeatScore = this.calculateInitialHeatScore(input.content, input.context);

    // Insert into database
    const query = `
      INSERT INTO agent_memories (
        id, agent_id, content, context, tags, 
        heat_score, expires_at, created_at, last_accessed, access_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      memoryId,
      input.agentId,
      input.content,
      JSON.stringify(input.context),
      JSON.stringify(input.tags || []),
      initialHeatScore,
      input.expiresAt || null,
      now,
      now,
      0,
    ];

    const result = await this.pool.query(query, values);
    const row = result.rows[0];

    const memory: AgentMemory = {
      id: row.id,
      agentId: row.agent_id,
      content: row.content,
      embedding,
      context: JSON.parse(row.context),
      metadata: {
        relevanceScore: 1.0,
        heatScore: row.heat_score,
        expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
        tags: JSON.parse(row.tags),
        isActive: row.is_active,
      },
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    };

    // Store in vector database if enabled
    if (this.isVectorEnabled && embedding) {
      try {
        await vectorStoreService.upsertMemory(memory);
      } catch (error) {
        logger.error('Failed to store memory in vector database', { error, memoryId });
        // Continue even if vector storage fails
      }
    }

    logger.info('Memory created', { memoryId, agentId: input.agentId });
    return memory;
  }

  /**
   * Search memories using semantic similarity
   */
  async searchMemories(query: MemoryQuery): Promise<MemorySearchResult[]> {
    // If vector search is available and query text is provided
    if (this.isVectorEnabled && query.query) {
      try {
        const queryVector = await embeddingService.generateEmbedding(query.query);
        const results = await vectorStoreService.searchSimilarMemories(
          query.agentId,
          queryVector,
          query.limit || 10,
          query.minRelevance || 0.7,
        );

        // Update access tracking for found memories
        if (results.length > 0) {
          await this.updateMemoryAccess(results.map((r) => r.memory.id));
        }

        return this.sortMemories(results, query.sortBy || 'relevance');
      } catch (error) {
        logger.error('Vector search failed, falling back to database', { error });
        // Fall through to database search
      }
    }

    // Fallback to database search
    return this.searchMemoriesInDatabase(query);
  }

  /**
   * Get memories for an agent from database
   */
  private async searchMemoriesInDatabase(query: MemoryQuery): Promise<MemorySearchResult[]> {
    let sql = `
      SELECT * FROM agent_memories
      WHERE agent_id = $1 AND is_active = true
    `;
    const params: any[] = [query.agentId];
    let paramIndex = 2;

    // Add context filters
    if (query.contextFilter) {
      const filters = [];
      if (query.contextFilter.forumId) {
        filters.push(`context->>'forumId' = $${paramIndex}`);
        params.push(query.contextFilter.forumId);
        paramIndex++;
      }
      if (query.contextFilter.postId) {
        filters.push(`context->>'postId' = $${paramIndex}`);
        params.push(query.contextFilter.postId);
        paramIndex++;
      }
      if (query.contextFilter.interactionType) {
        filters.push(`context->>'interactionType' = $${paramIndex}`);
        params.push(query.contextFilter.interactionType);
        paramIndex++;
      }
      if (filters.length > 0) {
        sql += ` AND ${filters.join(' AND ')}`;
      }
    }

    // Add sorting
    const sortColumn =
      query.sortBy === 'heat'
        ? 'heat_score'
        : query.sortBy === 'recency'
          ? 'created_at'
          : 'heat_score';
    sql += ` ORDER BY ${sortColumn} DESC`;

    // Add limit
    sql += ` LIMIT $${paramIndex}`;
    params.push(query.limit || 10);

    const result = await this.pool.query(sql, params);

    const memories: MemorySearchResult[] = result.rows.map((row) => ({
      memory: {
        id: row.id,
        agentId: row.agent_id,
        content: row.content,
        context: JSON.parse(row.context),
        metadata: {
          relevanceScore: 1.0,
          heatScore: row.heat_score,
          expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
          tags: JSON.parse(row.tags),
          isActive: row.is_active,
        },
        createdAt: row.created_at,
        lastAccessed: row.last_accessed,
        accessCount: row.access_count,
      },
      score: row.heat_score,
    }));

    // Update access tracking
    if (memories.length > 0) {
      await this.updateMemoryAccess(memories.map((m) => m.memory.id));
    }

    return memories;
  }

  /**
   * Get a specific memory by ID
   */
  async getMemory(memoryId: string): Promise<AgentMemory> {
    const query = `
      SELECT * FROM agent_memories
      WHERE id = $1 AND is_active = true
    `;
    const result = await this.pool.query(query, [memoryId]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Memory not found');
    }

    const row = result.rows[0];

    // Update access tracking
    await this.updateMemoryAccess([memoryId]);

    return {
      id: row.id,
      agentId: row.agent_id,
      content: row.content,
      context: JSON.parse(row.context),
      metadata: {
        relevanceScore: 1.0,
        heatScore: row.heat_score,
        expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
        tags: JSON.parse(row.tags),
        isActive: row.is_active,
      },
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    };
  }

  /**
   * Get memory statistics for an agent
   */
  async getMemoryStats(agentId: string): Promise<MemoryStats> {
    const query = `
      SELECT
        COUNT(*) as total_memories,
        COUNT(*) FILTER (WHERE is_active = true) as active_memories,
        AVG(heat_score) as avg_heat_score,
        MIN(created_at) as oldest_memory,
        MAX(created_at) as newest_memory
      FROM agent_memories
      WHERE agent_id = $1
    `;

    const result = await this.pool.query(query, [agentId]);
    const row = result.rows[0];

    // Get top contexts
    const contextQuery = `
      SELECT context->>'interactionType' as type, COUNT(*) as count
      FROM agent_memories
      WHERE agent_id = $1 AND is_active = true
      GROUP BY context->>'interactionType'
      ORDER BY count DESC
      LIMIT 5
    `;
    const contextResult = await this.pool.query(contextQuery, [agentId]);

    return {
      totalMemories: parseInt(row.total_memories, 10),
      activeMemories: parseInt(row.active_memories, 10),
      averageHeatScore: parseFloat(row.avg_heat_score) || 0,
      oldestMemory: row.oldest_memory ? new Date(row.oldest_memory) : undefined,
      newestMemory: row.newest_memory ? new Date(row.newest_memory) : undefined,
      topContexts: contextResult.rows
        .filter((r) => r.type)
        .map((r) => ({
          type: r.type,
          count: parseInt(r.count, 10),
        })),
    };
  }

  /**
   * Clean up expired and low-value memories
   */
  async cleanupMemories(config?: MemoryCleanupConfig): Promise<number> {
    const maxAge = config?.maxAge || env.MEMORY_EXPIRATION_DAYS;
    const minHeatScore = config?.minHeatScore || env.MEMORY_MIN_HEAT_SCORE;
    const batchSize = config?.batchSize || env.MEMORY_CLEANUP_BATCH_SIZE;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAge);

    // Find memories to delete
    const selectQuery = `
      SELECT id FROM agent_memories
      WHERE is_active = true
      AND (
        expires_at IS NOT NULL AND expires_at < NOW()
        OR (created_at < $1 AND heat_score < $2)
      )
      LIMIT $3
    `;

    const result = await this.pool.query(selectQuery, [cutoffDate, minHeatScore, batchSize]);
    const memoryIds = result.rows.map((row) => row.id);

    if (memoryIds.length === 0) {
      logger.info('No memories to cleanup');
      return 0;
    }

    // Soft delete in database
    const deleteQuery = `
      UPDATE agent_memories
      SET is_active = false, updated_at = NOW()
      WHERE id = ANY($1)
    `;
    await this.pool.query(deleteQuery, [memoryIds]);

    // Delete from vector store if enabled
    if (this.isVectorEnabled) {
      try {
        await vectorStoreService.deleteMemories(memoryIds);
      } catch (error) {
        logger.error('Failed to delete memories from vector store', {
          error,
          count: memoryIds.length,
        });
      }
    }

    logger.info('Memories cleaned up', { count: memoryIds.length });
    return memoryIds.length;
  }

  /**
   * Delete a specific memory
   */
  async deleteMemory(memoryId: string): Promise<void> {
    // Soft delete in database
    const query = `
      UPDATE agent_memories
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
    `;
    const result = await this.pool.query(query, [memoryId]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Memory not found');
    }

    // Delete from vector store if enabled
    if (this.isVectorEnabled) {
      try {
        await vectorStoreService.deleteMemory(memoryId);
      } catch (error) {
        logger.error('Failed to delete memory from vector store', { error, memoryId });
      }
    }

    logger.info('Memory deleted', { memoryId });
  }

  /**
   * Update memory access tracking and heat score
   */
  private async updateMemoryAccess(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;

    const query = `
      UPDATE agent_memories
      SET 
        last_accessed = NOW(),
        access_count = access_count + 1,
        heat_score = LEAST(heat_score * $2, 1.0)
      WHERE id = ANY($1)
    `;

    await this.pool.query(query, [memoryIds, this.HEAT_SCORE_MULTIPLIER]);
  }

  /**
   * Calculate initial heat score based on content and context
   */
  private calculateInitialHeatScore(content: string, context: any): number {
    let score = 0.5; // Base score

    // Longer content is more valuable
    if (content.length > 500) score += 0.1;
    if (content.length > 1000) score += 0.1;

    // Certain interaction types are more important
    if (context.interactionType === 'post') score += 0.2;
    else if (context.interactionType === 'comment') score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Sort memory search results
   */
  private sortMemories(results: MemorySearchResult[], sortBy: string): MemorySearchResult[] {
    switch (sortBy) {
      case 'heat':
        return results.sort((a, b) => b.memory.metadata.heatScore - a.memory.metadata.heatScore);
      case 'recency':
        return results.sort((a, b) => b.memory.createdAt.getTime() - a.memory.createdAt.getTime());
      case 'relevance':
      default:
        return results.sort((a, b) => b.score - a.score);
    }
  }
}
