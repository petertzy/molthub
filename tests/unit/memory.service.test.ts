/**
 * Memory Service Unit Tests
 */

import { MemoryService } from '@modules/memory/memory.service';
import { embeddingService } from '@modules/memory/embedding.service';
import { vectorStoreService } from '@modules/memory/vector-store.service';
import { Pool } from 'pg';

// Mock uuid
jest.mock('uuid', () => ({
  v4: () => 'test-memory-uuid-1234',
}));

// Mock embedding service
jest.mock('@modules/memory/embedding.service', () => ({
  embeddingService: {
    isServiceEnabled: jest.fn(() => false),
    generateEmbedding: jest.fn(),
    generateEmbeddings: jest.fn(),
    cosineSimilarity: jest.fn(),
  },
}));

// Mock vector store service
jest.mock('@modules/memory/vector-store.service', () => ({
  vectorStoreService: {
    isServiceEnabled: jest.fn(() => false),
    initialize: jest.fn(() => Promise.resolve()),
    upsertMemory: jest.fn(() => Promise.resolve()),
    upsertMemories: jest.fn(() => Promise.resolve()),
    searchSimilarMemories: jest.fn(() => Promise.resolve([])),
    deleteMemory: jest.fn(() => Promise.resolve()),
    deleteMemories: jest.fn(() => Promise.resolve()),
    deleteAgentMemories: jest.fn(() => Promise.resolve()),
  },
}));

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };

    memoryService = new MemoryService(mockPool);
    jest.clearAllMocks();
  });

  describe('createMemory', () => {
    it('should create a memory without vector database', async () => {
      const mockResult = {
        rows: [
          {
            id: 'test-memory-uuid-1234',
            agent_id: 'agent-123',
            content: 'Test memory content',
            context: JSON.stringify({ forumId: 'forum-1', interactionType: 'post' }),
            tags: JSON.stringify(['test']),
            heat_score: 0.7,
            expires_at: null,
            created_at: new Date('2026-02-12T10:00:00Z'),
            last_accessed: new Date('2026-02-12T10:00:00Z'),
            access_count: 0,
            is_active: true,
          },
        ],
        rowCount: 1,
      };

      mockPool.query.mockResolvedValueOnce(mockResult as any);

      const input = {
        agentId: 'agent-123',
        content: 'Test memory content',
        context: {
          forumId: 'forum-1',
          interactionType: 'post' as const,
          timestamp: new Date('2026-02-12T10:00:00Z'),
        },
        tags: ['test'],
      };

      const memory = await memoryService.createMemory(input);

      expect(memory.id).toBe('test-memory-uuid-1234');
      expect(memory.agentId).toBe('agent-123');
      expect(memory.content).toBe('Test memory content');
      expect(memory.context.forumId).toBe('forum-1');
      expect(memory.metadata.tags).toEqual(['test']);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agent_memories'),
        expect.arrayContaining(['test-memory-uuid-1234', 'agent-123', 'Test memory content']),
      );
    });

    it('should handle vector database when enabled', async () => {
      // Create a new service instance with mocked enabled services
      (embeddingService.isServiceEnabled as jest.Mock).mockReturnValue(true);
      (vectorStoreService.isServiceEnabled as jest.Mock).mockReturnValue(true);
      (embeddingService.generateEmbedding as jest.Mock).mockResolvedValue([0.1, 0.2, 0.3]);

      const enabledService = new MemoryService(mockPool);
      // Force enable vector
      (enabledService as any).isVectorEnabled = true;

      const mockResult = {
        rows: [
          {
            id: 'test-memory-uuid-1234',
            agent_id: 'agent-123',
            content: 'Test memory content',
            context: JSON.stringify({ forumId: 'forum-1' }),
            tags: JSON.stringify([]),
            heat_score: 0.5,
            expires_at: null,
            created_at: new Date(),
            last_accessed: new Date(),
            access_count: 0,
            is_active: true,
          },
        ],
        rowCount: 1,
      };

      mockPool.query.mockResolvedValueOnce(mockResult);

      const input = {
        agentId: 'agent-123',
        content: 'Test memory content',
        context: {
          timestamp: new Date(),
        },
      };

      const memory = await enabledService.createMemory(input);

      expect(embeddingService.generateEmbedding).toHaveBeenCalledWith('Test memory content');
      expect(vectorStoreService.upsertMemory).toHaveBeenCalled();
      expect(memory.embedding).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe('getMemory', () => {
    it('should retrieve a memory by ID', async () => {
      const mockResult = {
        rows: [
          {
            id: 'memory-1',
            agent_id: 'agent-123',
            content: 'Test content',
            context: JSON.stringify({ forumId: 'forum-1' }),
            tags: JSON.stringify(['test']),
            heat_score: 0.8,
            expires_at: null,
            created_at: new Date('2026-02-10T10:00:00Z'),
            last_accessed: new Date('2026-02-11T10:00:00Z'),
            access_count: 5,
            is_active: true,
          },
        ],
        rowCount: 1,
      };

      mockPool.query
        .mockResolvedValueOnce(mockResult as any)
        .mockResolvedValueOnce({ rowCount: 1 } as any);

      const memory = await memoryService.getMemory('memory-1');

      expect(memory.id).toBe('memory-1');
      expect(memory.agentId).toBe('agent-123');
      expect(memory.accessCount).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM agent_memories'), ['memory-1']);
    });

    it('should throw NotFoundError when memory does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      await expect(memoryService.getMemory('nonexistent')).rejects.toThrow('Memory not found');
    });
  });

  describe('getMemoryStats', () => {
    it('should return memory statistics for an agent', async () => {
      const mockStatsResult = {
        rows: [
          {
            total_memories: '10',
            active_memories: '8',
            avg_heat_score: '0.65',
            oldest_memory: new Date('2026-01-01T00:00:00Z'),
            newest_memory: new Date('2026-02-12T00:00:00Z'),
          },
        ],
      };

      const mockContextResult = {
        rows: [
          { type: 'post', count: '5' },
          { type: 'comment', count: '3' },
        ],
      };

      mockPool.query.mockResolvedValueOnce(mockStatsResult as any).mockResolvedValueOnce(mockContextResult as any);

      const stats = await memoryService.getMemoryStats('agent-123');

      expect(stats.totalMemories).toBe(10);
      expect(stats.activeMemories).toBe(8);
      expect(stats.averageHeatScore).toBe(0.65);
      expect(stats.topContexts).toHaveLength(2);
      expect(stats.topContexts[0]).toEqual({ type: 'post', count: 5 });
    });
  });

  describe('cleanupMemories', () => {
    it('should cleanup expired and low-value memories', async () => {
      const mockSelectResult = {
        rows: [{ id: 'memory-1' }, { id: 'memory-2' }, { id: 'memory-3' }],
      };

      mockPool.query
        .mockResolvedValueOnce(mockSelectResult as any)
        .mockResolvedValueOnce({ rowCount: 3 } as any);

      const count = await memoryService.cleanupMemories({
        maxAge: 90,
        minHeatScore: 0.1,
        batchSize: 100,
      });

      expect(count).toBe(3);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id FROM agent_memories'),
        expect.any(Array),
      );
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE agent_memories'), [
        ['memory-1', 'memory-2', 'memory-3'],
      ]);
    });

    it('should return 0 when no memories need cleanup', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);

      const count = await memoryService.cleanupMemories();

      expect(count).toBe(0);
    });
  });

  describe('deleteMemory', () => {
    it('should soft delete a memory', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 } as any);

      await memoryService.deleteMemory('memory-1');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agent_memories'),
        expect.arrayContaining(['memory-1']),
      );
    });

    it('should throw NotFoundError when memory does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 } as any);

      await expect(memoryService.deleteMemory('nonexistent')).rejects.toThrow('Memory not found');
    });
  });

  describe('searchMemories', () => {
    it('should search memories from database when vector search is disabled', async () => {
      const mockResult = {
        rows: [
          {
            id: 'memory-1',
            agent_id: 'agent-123',
            content: 'Memory 1',
            context: JSON.stringify({}),
            tags: JSON.stringify([]),
            heat_score: 0.9,
            expires_at: null,
            created_at: new Date(),
            last_accessed: new Date(),
            access_count: 10,
            is_active: true,
          },
          {
            id: 'memory-2',
            agent_id: 'agent-123',
            content: 'Memory 2',
            context: JSON.stringify({}),
            tags: JSON.stringify([]),
            heat_score: 0.7,
            expires_at: null,
            created_at: new Date(),
            last_accessed: new Date(),
            access_count: 5,
            is_active: true,
          },
        ],
      };

      mockPool.query
        .mockResolvedValueOnce(mockResult as any)
        .mockResolvedValueOnce({ rowCount: 2 } as any);

      const results = await memoryService.searchMemories({
        agentId: 'agent-123',
        limit: 10,
      });

      expect(results).toHaveLength(2);
      expect(results[0].memory.id).toBe('memory-1');
      expect(results[0].score).toBe(0.9);
    });
  });
});
