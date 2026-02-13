/**
 * Vector Store Service
 * Handles vector database operations using Pinecone
 */

import { Pinecone, Index } from '@pinecone-database/pinecone';
import { env } from '@config/env';
import { logger } from '@config/logger';
import { AgentMemory, MemoryContext, MemorySearchResult } from './memory.types';

interface VectorMetadata {
  agentId: string;
  content: string;
  context: string; // JSON stringified MemoryContext
  metadata: string; // JSON stringified MemoryMetadata
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
}

export class VectorStoreService {
  private client: Pinecone | null = null;
  private index: Index | null = null;
  private isEnabled: boolean;
  private indexName: string;
  private readonly EMBEDDING_DIMENSION = 1536; // text-embedding-3-small dimension

  constructor() {
    this.indexName = env.PINECONE_INDEX;
    this.isEnabled = !!env.PINECONE_API_KEY;

    if (this.isEnabled && env.PINECONE_API_KEY) {
      this.client = new Pinecone({
        apiKey: env.PINECONE_API_KEY,
      });
      logger.info('Vector store service initialized', { index: this.indexName });
    } else {
      logger.warn('Vector store service disabled - PINECONE_API_KEY not configured');
    }
  }

  /**
   * Initialize the Pinecone index connection
   */
  async initialize(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      this.index = this.client.index(this.indexName);
      logger.info('Vector store index connected', { index: this.indexName });
    } catch (error) {
      logger.error('Failed to connect to vector store index', { error, index: this.indexName });
      throw error;
    }
  }

  /**
   * Check if vector store is enabled
   */
  isServiceEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Upsert a memory vector into Pinecone
   */
  async upsertMemory(memory: AgentMemory): Promise<void> {
    if (!this.index || !memory.embedding) {
      throw new Error('Vector store not initialized or embedding missing');
    }

    try {
      const metadata: VectorMetadata = {
        agentId: memory.agentId,
        content: memory.content,
        context: JSON.stringify(memory.context),
        metadata: JSON.stringify(memory.metadata),
        createdAt: memory.createdAt.toISOString(),
        lastAccessed: memory.lastAccessed.toISOString(),
        accessCount: memory.accessCount,
      };

      await this.index.upsert({
        records: [
          {
            id: memory.id,
            values: memory.embedding,
            metadata: metadata as any,
          },
        ],
      } as any);

      logger.debug('Memory vector upserted', { memoryId: memory.id, agentId: memory.agentId });
    } catch (error) {
      logger.error('Failed to upsert memory vector', { error, memoryId: memory.id });
      throw error;
    }
  }

  /**
   * Batch upsert multiple memory vectors
   */
  async upsertMemories(memories: AgentMemory[]): Promise<void> {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }

    try {
      const vectors = memories
        .filter((m) => m.embedding)
        .map((memory) => ({
          id: memory.id,
          values: memory.embedding!,
          metadata: {
            agentId: memory.agentId,
            content: memory.content,
            context: JSON.stringify(memory.context),
            metadata: JSON.stringify(memory.metadata),
            createdAt: memory.createdAt.toISOString(),
            lastAccessed: memory.lastAccessed.toISOString(),
            accessCount: memory.accessCount,
          } as any,
        }));

      if (vectors.length === 0) {
        return;
      }

      await this.index.upsert({
        records: vectors,
      } as any);
      logger.debug('Batch memory vectors upserted', { count: vectors.length });
    } catch (error) {
      logger.error('Failed to batch upsert memory vectors', { error, count: memories.length });
      throw error;
    }
  }

  /**
   * Search for similar memories using vector similarity
   */
  async searchSimilarMemories(
    agentId: string,
    queryVector: number[],
    limit: number = 10,
    minScore: number = 0.7,
  ): Promise<MemorySearchResult[]> {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }

    try {
      const queryResponse = await this.index.query({
        vector: queryVector,
        topK: limit,
        includeMetadata: true,
        filter: {
          agentId: { $eq: agentId },
        },
      });

      const results: MemorySearchResult[] = queryResponse.matches
        .filter((match) => (match.score || 0) >= minScore)
        .map((match) => {
          const metadata = match.metadata as unknown as VectorMetadata;
          const memory: AgentMemory = {
            id: match.id,
            agentId: metadata.agentId,
            content: metadata.content,
            embedding: undefined, // Don't return embedding to save bandwidth
            context: JSON.parse(metadata.context) as MemoryContext,
            metadata: JSON.parse(metadata.metadata),
            createdAt: new Date(metadata.createdAt),
            lastAccessed: new Date(metadata.lastAccessed),
            accessCount: metadata.accessCount,
          };

          return {
            memory,
            score: match.score || 0,
          };
        });

      logger.debug('Similar memories found', {
        agentId,
        count: results.length,
        topScore: results[0]?.score,
      });

      return results;
    } catch (error) {
      logger.error('Failed to search similar memories', { error, agentId });
      throw error;
    }
  }

  /**
   * Delete a memory vector from Pinecone
   */
  async deleteMemory(memoryId: string): Promise<void> {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }

    try {
      await (this.index as any).deleteOne(memoryId);
      logger.debug('Memory vector deleted', { memoryId });
    } catch (error) {
      logger.error('Failed to delete memory vector', { error, memoryId });
      throw error;
    }
  }

  /**
   * Delete multiple memory vectors
   */
  async deleteMemories(memoryIds: string[]): Promise<void> {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }

    try {
      await this.index.deleteMany(memoryIds);
      logger.debug('Memory vectors deleted', { count: memoryIds.length });
    } catch (error) {
      logger.error('Failed to delete memory vectors', { error, count: memoryIds.length });
      throw error;
    }
  }

  /**
   * Delete all memories for an agent
   */
  async deleteAgentMemories(agentId: string): Promise<void> {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }

    try {
      // Pinecone v7 doesn't support filter-based delete directly
      // We need to query for IDs first, then delete them
      const queryResponse = await this.index.query({
        vector: Array(this.EMBEDDING_DIMENSION).fill(0), // Dummy vector
        topK: 10000, // Maximum
        includeMetadata: false,
        filter: {
          agentId: { $eq: agentId },
        } as any,
      });

      const ids = queryResponse.matches.map((match) => match.id);
      if (ids.length > 0) {
        await this.index.deleteMany(ids);
      }

      logger.info('All agent memories deleted', { agentId, count: ids.length });
    } catch (error) {
      logger.error('Failed to delete agent memories', { error, agentId });
      throw error;
    }
  }
}

// Export singleton instance
export const vectorStoreService = new VectorStoreService();
