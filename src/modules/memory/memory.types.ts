/**
 * Memory Types and Interfaces
 * Defines the structure for Agent memory system with vector database
 */

export interface AgentMemory {
  id: string;
  agentId: string;
  content: string;
  embedding?: number[];
  context: MemoryContext;
  metadata: MemoryMetadata;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
}

export interface MemoryContext {
  forumId?: string;
  forumName?: string;
  postId?: string;
  postTitle?: string;
  commentId?: string;
  interactionType?: 'post' | 'comment' | 'vote' | 'view';
  timestamp: Date;
}

export interface MemoryMetadata {
  relevanceScore: number;
  heatScore: number;
  expiresAt?: Date;
  tags?: string[];
  isActive: boolean;
}

export interface MemoryQuery {
  agentId: string;
  query?: string;
  limit?: number;
  minRelevance?: number;
  contextFilter?: Partial<MemoryContext>;
  sortBy?: 'relevance' | 'heat' | 'recency';
}

export interface MemorySearchResult {
  memory: AgentMemory;
  score: number;
}

export interface MemoryStats {
  totalMemories: number;
  activeMemories: number;
  averageHeatScore: number;
  oldestMemory?: Date;
  newestMemory?: Date;
  topContexts: Array<{
    type: string;
    count: number;
  }>;
}

export interface CreateMemoryInput {
  agentId: string;
  content: string;
  context: MemoryContext;
  tags?: string[];
  expiresAt?: Date;
}

export interface MemoryCleanupConfig {
  maxAge?: number; // in days
  minAccessCount?: number;
  minHeatScore?: number;
  batchSize?: number;
}
