/**
 * Memory API Integration Tests
 */

// Mock uuid to avoid ESM issues with jest
jest.mock('uuid', () => {
  const { randomBytes } = require('crypto');
  return {
    v4: () => {
      const bytes = randomBytes(16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      return [
        bytes.toString('hex', 0, 4),
        bytes.toString('hex', 4, 6),
        bytes.toString('hex', 6, 8),
        bytes.toString('hex', 8, 10),
        bytes.toString('hex', 10, 16),
      ].join('-');
    },
  };
});

// Mock embedding and vector store services
jest.mock('@modules/memory/embedding.service', () => ({
  embeddingService: {
    isServiceEnabled: jest.fn(() => false),
    generateEmbedding: jest.fn(),
  },
}));

jest.mock('@modules/memory/vector-store.service', () => ({
  vectorStoreService: {
    isServiceEnabled: jest.fn(() => false),
    initialize: jest.fn().mockResolvedValue(undefined),
    upsertMemory: jest.fn(),
    deleteMemory: jest.fn(),
    deleteMemories: jest.fn(),
  },
}));

import { pool } from '@config/database';
import { MemoryService } from '@modules/memory/memory.service';

describe('Memory Service Integration Tests', () => {
  let memoryService: MemoryService;
  let testAgentId: string;

  beforeAll(async () => {
    memoryService = new MemoryService(pool);

    // Clean up any existing test data
    await pool.query("DELETE FROM agents WHERE name LIKE 'MemoryTestAgent%'");
    await pool.query("DELETE FROM agent_memories WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'MemoryTestAgent%')");

    // Create a test agent
    const agentResult = await pool.query(
      `INSERT INTO agents (name, description, is_active) 
       VALUES ($1, $2, $3) 
       RETURNING id`,
      ['MemoryTestAgent1', 'Test agent for memory testing', true],
    );
    testAgentId = agentResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM agent_memories WHERE agent_id = $1", [testAgentId]);
    await pool.query("DELETE FROM agents WHERE id = $1", [testAgentId]);
  });

  describe('createMemory', () => {
    it('should create a memory in the database', async () => {
      const input = {
        agentId: testAgentId,
        content: 'This is a test memory about quantum computing',
        context: {
          forumId: 'forum-1',
          postId: 'post-123',
          interactionType: 'post' as const,
          timestamp: new Date(),
        },
        tags: ['quantum', 'computing'],
      };

      const memory = await memoryService.createMemory(input);

      expect(memory.id).toBeDefined();
      expect(memory.agentId).toBe(testAgentId);
      expect(memory.content).toBe('This is a test memory about quantum computing');
      expect(memory.context.forumId).toBe('forum-1');
      expect(memory.metadata.tags).toEqual(['quantum', 'computing']);
      expect(memory.metadata.heatScore).toBeGreaterThan(0);
      expect(memory.accessCount).toBe(0);

      // Verify it's in the database
      const result = await pool.query('SELECT * FROM agent_memories WHERE id = $1', [memory.id]);
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].content).toBe('This is a test memory about quantum computing');
    });

    it('should create memory with expiration', async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const input = {
        agentId: testAgentId,
        content: 'Temporary memory',
        context: {
          timestamp: new Date(),
        },
        expiresAt,
      };

      const memory = await memoryService.createMemory(input);

      expect(memory.metadata.expiresAt).toBeDefined();
      expect(memory.metadata.expiresAt!.getTime()).toBeCloseTo(expiresAt.getTime(), -2);
    });
  });

  describe('getMemory', () => {
    it('should retrieve a memory by ID', async () => {
      // Create a memory first
      const input = {
        agentId: testAgentId,
        content: 'Memory to retrieve',
        context: {
          timestamp: new Date(),
        },
      };

      const created = await memoryService.createMemory(input);
      
      // Retrieve it
      const retrieved = await memoryService.getMemory(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.content).toBe('Memory to retrieve');
      expect(retrieved.accessCount).toBe(1); // Should increment on retrieval
    });

    it('should throw NotFoundError for non-existent memory', async () => {
      await expect(memoryService.getMemory('non-existent-id')).rejects.toThrow('Memory not found');
    });
  });

  describe('searchMemories', () => {
    beforeAll(async () => {
      // Create multiple memories for searching
      const memories = [
        {
          agentId: testAgentId,
          content: 'Memory about AI and machine learning',
          context: { forumId: 'ai-forum', interactionType: 'post' as const, timestamp: new Date() },
        },
        {
          agentId: testAgentId,
          content: 'Discussion about blockchain technology',
          context: { forumId: 'crypto-forum', interactionType: 'comment' as const, timestamp: new Date() },
        },
        {
          agentId: testAgentId,
          content: 'Thoughts on quantum computing',
          context: { forumId: 'ai-forum', interactionType: 'post' as const, timestamp: new Date() },
        },
      ];

      for (const memory of memories) {
        await memoryService.createMemory(memory);
      }
    });

    it('should search memories without query text', async () => {
      const results = await memoryService.searchMemories({
        agentId: testAgentId,
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.agentId).toBe(testAgentId);
    });

    it('should filter memories by context', async () => {
      const results = await memoryService.searchMemories({
        agentId: testAgentId,
        contextFilter: {
          forumId: 'ai-forum',
        },
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result.memory.context.forumId).toBe('ai-forum');
      });
    });

    it('should respect limit parameter', async () => {
      const results = await memoryService.searchMemories({
        agentId: testAgentId,
        limit: 2,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getMemoryStats', () => {
    it('should return accurate statistics', async () => {
      const stats = await memoryService.getMemoryStats(testAgentId);

      expect(stats.totalMemories).toBeGreaterThan(0);
      expect(stats.activeMemories).toBeGreaterThan(0);
      expect(stats.averageHeatScore).toBeGreaterThanOrEqual(0);
      expect(stats.averageHeatScore).toBeLessThanOrEqual(1);
      expect(stats.oldestMemory).toBeDefined();
      expect(stats.newestMemory).toBeDefined();
    });
  });

  describe('deleteMemory', () => {
    it('should soft delete a memory', async () => {
      // Create a memory
      const input = {
        agentId: testAgentId,
        content: 'Memory to delete',
        context: {
          timestamp: new Date(),
        },
      };

      const memory = await memoryService.createMemory(input);

      // Delete it
      await memoryService.deleteMemory(memory.id);

      // Verify it's soft deleted
      const result = await pool.query('SELECT is_active FROM agent_memories WHERE id = $1', [memory.id]);
      expect(result.rows[0].is_active).toBe(false);

      // Should not be retrievable
      await expect(memoryService.getMemory(memory.id)).rejects.toThrow('Memory not found');
    });
  });

  describe('cleanupMemories', () => {
    it('should cleanup expired memories', async () => {
      // Create an expired memory
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const input = {
        agentId: testAgentId,
        content: 'Expired memory',
        context: {
          timestamp: new Date(),
        },
        expiresAt: pastDate,
      };

      await memoryService.createMemory(input);

      // Run cleanup
      const count = await memoryService.cleanupMemories({
        maxAge: 365,
        minHeatScore: 0,
        batchSize: 100,
      });

      expect(count).toBeGreaterThan(0);
    });

    it('should cleanup old low-heat memories', async () => {
      // Create a memory and manually set it to be old with low heat
      const result = await pool.query(
        `INSERT INTO agent_memories (agent_id, content, context, heat_score, created_at)
         VALUES ($1, $2, $3, $4, NOW() - INTERVAL '100 days')
         RETURNING id`,
        [testAgentId, 'Old low-heat memory', JSON.stringify({ timestamp: new Date() }), 0.05],
      );

      const memoryId = result.rows[0].id;

      // Run cleanup
      const count = await memoryService.cleanupMemories({
        maxAge: 90,
        minHeatScore: 0.1,
        batchSize: 100,
      });

      expect(count).toBeGreaterThan(0);

      // Verify it was cleaned
      const checkResult = await pool.query('SELECT is_active FROM agent_memories WHERE id = $1', [memoryId]);
      expect(checkResult.rows[0].is_active).toBe(false);
    });
  });
});
