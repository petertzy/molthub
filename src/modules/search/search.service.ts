/**
 * Search Service
 * Handles full-text and semantic search operations
 */

import { Pool } from 'pg';
import { logger } from '@config/logger';
import { embeddingService } from '@modules/memory/embedding.service';
import { vectorStoreService } from '@modules/memory/vector-store.service';
import {
  SearchQuery,
  SearchResponse,
  SearchResults,
  PostSearchResult,
  CommentSearchResult,
  ForumSearchResult,
  AgentSearchResult,
  SemanticSearchQuery,
  SemanticSearchResponse,
  SemanticSearchResult,
} from './search.types';

export class SearchService {
  constructor(private pool: Pool) {}

  /**
   * Full-text search across multiple content types
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const { q, type = 'all', forum, sort = 'relevance', limit = 20, offset = 0 } = query;

    // Validate query
    if (!q || q.trim().length === 0) {
      throw new Error('Search query is required');
    }

    // Validate limit
    const validLimit = Math.min(Math.max(1, limit), 100);
    const validOffset = Math.max(0, offset);

    const results: SearchResults = {};
    let total = 0;

    // Search based on type
    if (type === 'all' || type === 'posts') {
      const postResults = await this.searchPosts(q, forum, sort, validLimit, validOffset);
      results.posts = postResults.items;
      if (type === 'posts') {
        total = postResults.total;
      }
    }

    if (type === 'all' || type === 'comments') {
      const commentResults = await this.searchComments(q, forum, sort, validLimit, validOffset);
      results.comments = commentResults.items;
      if (type === 'comments') {
        total = commentResults.total;
      }
    }

    if (type === 'all' || type === 'forums') {
      const forumResults = await this.searchForums(q, sort, validLimit, validOffset);
      results.forums = forumResults.items;
      if (type === 'forums') {
        total = forumResults.total;
      }
    }

    if (type === 'all' || type === 'agents') {
      const agentResults = await this.searchAgents(q, sort, validLimit, validOffset);
      results.agents = agentResults.items;
      if (type === 'agents') {
        total = agentResults.total;
      }
    }

    // For 'all' type, sum up total counts
    if (type === 'all') {
      total =
        (results.posts?.length || 0) +
        (results.comments?.length || 0) +
        (results.forums?.length || 0) +
        (results.agents?.length || 0);
    }

    logger.info('Search completed', {
      query: q,
      type,
      total,
      resultsCount: {
        posts: results.posts?.length || 0,
        comments: results.comments?.length || 0,
        forums: results.forums?.length || 0,
        agents: results.agents?.length || 0,
      },
    });

    return {
      results,
      pagination: {
        total,
        limit: validLimit,
        offset: validOffset,
      },
    };
  }

  /**
   * Search posts using PostgreSQL full-text search
   */
  private async searchPosts(
    query: string,
    forum?: string,
    sort: string = 'relevance',
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ items: PostSearchResult[]; total: number }> {
    try {
      // Create search query with ts_query
      const tsQuery = query
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => `${word}:*`)
        .join(' & ');

      let sqlQuery = `
        SELECT 
          p.id,
          p.title,
          p.content,
          p.created_at,
          p.vote_count,
          p.comment_count,
          f.name as forum_name,
          f.id as forum_id,
          a.name as author_name,
          a.id as author_id,
          ts_rank(
            to_tsvector('english', p.title || ' ' || p.content),
            to_tsquery('english', $1)
          ) as relevance_score,
          ts_headline('english', p.content, to_tsquery('english', $1),
            'MaxWords=50, MinWords=25, MaxFragments=1') as excerpt,
          COUNT(*) OVER() as total_count
        FROM posts p
        INNER JOIN forums f ON p.forum_id = f.id
        INNER JOIN agents a ON p.author_id = a.id
        WHERE p.deleted_at IS NULL
          AND to_tsvector('english', p.title || ' ' || p.content) @@ to_tsquery('english', $1)
      `;

      const params: any[] = [tsQuery];
      let paramIndex = 2;

      // Add forum filter if specified
      if (forum) {
        // Check if forum is a valid UUID format, otherwise treat as slug
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          forum,
        );
        if (isUUID) {
          sqlQuery += ` AND f.id = $${paramIndex}::uuid`;
        } else {
          sqlQuery += ` AND f.slug = $${paramIndex}`;
        }
        params.push(forum);
        paramIndex++;
      }

      // Add sorting
      if (sort === 'relevance') {
        sqlQuery += ` ORDER BY relevance_score DESC, p.created_at DESC`;
      } else if (sort === 'newest') {
        sqlQuery += ` ORDER BY p.created_at DESC`;
      } else if (sort === 'top') {
        sqlQuery += ` ORDER BY p.vote_count DESC, p.created_at DESC`;
      }

      sqlQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await this.pool.query(sqlQuery, params);

      const items: PostSearchResult[] = result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        forum: row.forum_name,
        forumId: row.forum_id,
        author: row.author_name,
        authorId: row.author_id,
        excerpt: row.excerpt,
        relevanceScore: parseFloat(row.relevance_score),
        createdAt: row.created_at,
        voteCount: row.vote_count,
        commentCount: row.comment_count,
      }));

      const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

      return { items, total };
    } catch (error) {
      logger.error('Failed to search posts', { error, query });
      throw error;
    }
  }

  /**
   * Search comments using PostgreSQL full-text search
   */
  private async searchComments(
    query: string,
    forum?: string,
    sort: string = 'relevance',
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ items: CommentSearchResult[]; total: number }> {
    try {
      const tsQuery = query
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => `${word}:*`)
        .join(' & ');

      let sqlQuery = `
        SELECT 
          c.id,
          c.content,
          c.post_id,
          c.created_at,
          c.vote_count,
          p.title as post_title,
          f.name as forum_name,
          f.id as forum_id,
          a.name as author_name,
          a.id as author_id,
          ts_rank(
            to_tsvector('english', c.content),
            to_tsquery('english', $1)
          ) as relevance_score,
          ts_headline('english', c.content, to_tsquery('english', $1),
            'MaxWords=50, MinWords=25, MaxFragments=1') as excerpt,
          COUNT(*) OVER() as total_count
        FROM comments c
        INNER JOIN posts p ON c.post_id = p.id
        INNER JOIN forums f ON p.forum_id = f.id
        INNER JOIN agents a ON c.author_id = a.id
        WHERE c.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND to_tsvector('english', c.content) @@ to_tsquery('english', $1)
      `;

      const params: any[] = [tsQuery];
      let paramIndex = 2;

      if (forum) {
        // Check if forum is a valid UUID format, otherwise treat as slug
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          forum,
        );
        if (isUUID) {
          sqlQuery += ` AND f.id = $${paramIndex}::uuid`;
        } else {
          sqlQuery += ` AND f.slug = $${paramIndex}`;
        }
        params.push(forum);
        paramIndex++;
      }

      if (sort === 'relevance') {
        sqlQuery += ` ORDER BY relevance_score DESC, c.created_at DESC`;
      } else if (sort === 'newest') {
        sqlQuery += ` ORDER BY c.created_at DESC`;
      } else if (sort === 'top') {
        sqlQuery += ` ORDER BY c.vote_count DESC, c.created_at DESC`;
      }

      sqlQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await this.pool.query(sqlQuery, params);

      const items: CommentSearchResult[] = result.rows.map((row) => ({
        id: row.id,
        content: row.content,
        postId: row.post_id,
        postTitle: row.post_title,
        forum: row.forum_name,
        forumId: row.forum_id,
        author: row.author_name,
        authorId: row.author_id,
        excerpt: row.excerpt,
        relevanceScore: parseFloat(row.relevance_score),
        createdAt: row.created_at,
        voteCount: row.vote_count,
      }));

      const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

      return { items, total };
    } catch (error) {
      logger.error('Failed to search comments', { error, query });
      throw error;
    }
  }

  /**
   * Search forums using PostgreSQL full-text search
   */
  private async searchForums(
    query: string,
    sort: string = 'relevance',
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ items: ForumSearchResult[]; total: number }> {
    try {
      const tsQuery = query
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => `${word}:*`)
        .join(' & ');

      let sqlQuery = `
        SELECT 
          f.id,
          f.name,
          f.slug,
          f.description,
          f.category,
          f.post_count,
          f.member_count,
          a.name as creator_name,
          a.id as creator_id,
          ts_rank(
            to_tsvector('english', f.name || ' ' || COALESCE(f.description, '')),
            to_tsquery('english', $1)
          ) as relevance_score,
          COUNT(*) OVER() as total_count
        FROM forums f
        INNER JOIN agents a ON f.creator_id = a.id
        WHERE f.is_archived = false
          AND to_tsvector('english', f.name || ' ' || COALESCE(f.description, '')) @@ to_tsquery('english', $1)
      `;

      const params: any[] = [tsQuery];

      if (sort === 'relevance') {
        sqlQuery += ` ORDER BY relevance_score DESC, f.post_count DESC`;
      } else if (sort === 'newest') {
        sqlQuery += ` ORDER BY f.created_at DESC`;
      } else if (sort === 'top') {
        sqlQuery += ` ORDER BY f.post_count DESC, f.member_count DESC`;
      }

      sqlQuery += ` LIMIT $2 OFFSET $3`;
      params.push(limit, offset);

      const result = await this.pool.query(sqlQuery, params);

      const items: ForumSearchResult[] = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description || '',
        category: row.category,
        creator: row.creator_name,
        creatorId: row.creator_id,
        relevanceScore: parseFloat(row.relevance_score),
        postCount: row.post_count,
        memberCount: row.member_count,
      }));

      const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

      return { items, total };
    } catch (error) {
      logger.error('Failed to search forums', { error, query });
      throw error;
    }
  }

  /**
   * Search agents using PostgreSQL full-text search
   */
  private async searchAgents(
    query: string,
    sort: string = 'relevance',
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ items: AgentSearchResult[]; total: number }> {
    try {
      // Create a pattern for ILIKE search (case-insensitive substring matching)
      const likePattern = `%${query.replace(/'/g, "''")}%`;
      
      // Also create full-text search query
      const tsQuery = query
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => `${word}:*`)
        .join(' & ');

      let sqlQuery = `
        SELECT 
          a.id,
          a.name,
          a.metadata,
          a.reputation_score,
          a.is_active,
          a.last_active,
          CASE 
            WHEN a.name ILIKE $1 THEN 100 
            WHEN a.metadata->>'description' ILIKE $1 THEN 80
            WHEN to_tsvector('english', a.name) @@ to_tsquery('english', $2) THEN 60
            WHEN to_tsvector('english', COALESCE(a.metadata->>'description', '')) @@ to_tsquery('english', $2) THEN 40
            ELSE 0
          END as relevance_score,
          COUNT(*) OVER() as total_count
        FROM agents a
        WHERE a.is_banned = false
          AND (a.name ILIKE $1 
               OR a.metadata->>'description' ILIKE $1
               OR to_tsvector('english', a.name) @@ to_tsquery('english', $2)
               OR to_tsvector('english', COALESCE(a.metadata->>'description', '')) @@ to_tsquery('english', $2))
      `;

      const params: any[] = [likePattern, tsQuery];

      if (sort === 'relevance') {
        sqlQuery += ` ORDER BY relevance_score DESC, a.reputation_score DESC`;
      } else if (sort === 'newest') {
        sqlQuery += ` ORDER BY a.created_at DESC`;
      } else if (sort === 'top') {
        sqlQuery += ` ORDER BY a.reputation_score DESC`;
      }

      sqlQuery += ` LIMIT $3 OFFSET $4`;
      params.push(limit, offset);

      const result = await this.pool.query(sqlQuery, params);

      const items: AgentSearchResult[] = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        metadata: row.metadata,
        relevanceScore: parseFloat(row.relevance_score) / 100, // Normalize to 0-1 range
        reputationScore: row.reputation_score,
        isActive: row.is_active,
        lastActive: row.last_active,
      }));

      const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

      return { items, total };
    } catch (error) {
      logger.error('Failed to search agents', { error, query });
      throw error;
    }
  }

  /**
   * Semantic search using vector similarity
   *
   * Note: This is a placeholder implementation. To fully enable semantic search:
   * 1. Store embeddings for posts/comments/forums/agents in Pinecone when they are created/updated
   * 2. Implement proper vector search queries for each content type
   * 3. Add background jobs to generate embeddings for existing content
   */
  async semanticSearch(query: SemanticSearchQuery): Promise<SemanticSearchResponse> {
    const { query: searchQuery, type = 'posts', limit = 10, minSimilarity = 0.7 } = query;

    // Check if embedding service is enabled
    if (!embeddingService.isServiceEnabled()) {
      throw new Error(
        'Semantic search is not available. Embedding service (OpenAI) is not configured.',
      );
    }

    if (!vectorStoreService.isServiceEnabled()) {
      throw new Error(
        'Semantic search is not available. Vector store service (Pinecone) is not configured.',
      );
    }

    try {
      // Generate embedding for the search query
      const queryEmbedding = await embeddingService.generateEmbedding(searchQuery);

      // Search based on type
      let results: SemanticSearchResult[] = [];

      if (type === 'posts') {
        results = await this.semanticSearchPosts(queryEmbedding, limit, minSimilarity);
      } else if (type === 'comments') {
        results = await this.semanticSearchComments(queryEmbedding, limit, minSimilarity);
      } else if (type === 'forums') {
        results = await this.semanticSearchForums(queryEmbedding, limit, minSimilarity);
      } else if (type === 'agents') {
        results = await this.semanticSearchAgents(queryEmbedding, limit, minSimilarity);
      }

      logger.info('Semantic search completed', {
        query: searchQuery,
        type,
        resultsCount: results.length,
      });

      return { results };
    } catch (error) {
      logger.error('Failed to perform semantic search', { error, query: searchQuery, type });
      throw error;
    }
  }

  /**
   * Semantic search for posts (placeholder - requires embeddings to be stored)
   *
   * TODO: To implement this feature:
   * 1. Generate and store embeddings for posts in Pinecone when posts are created/updated
   * 2. Use vectorStoreService to query for similar posts based on query embedding
   * 3. Fetch post details from PostgreSQL based on returned vector IDs
   * 4. Map results to SemanticSearchResult format
   */
  private async semanticSearchPosts(
    queryEmbedding: number[],
    limit: number,
    minSimilarity: number,
  ): Promise<SemanticSearchResult[]> {
    logger.warn(
      'Semantic search for posts not fully implemented - post embeddings need to be stored in vector database',
    );
    return [];
  }

  /**
   * Semantic search for comments (placeholder - requires embeddings to be stored)
   *
   * TODO: Similar to posts, requires embedding storage and retrieval implementation
   */
  private async semanticSearchComments(
    queryEmbedding: number[],
    limit: number,
    minSimilarity: number,
  ): Promise<SemanticSearchResult[]> {
    logger.warn(
      'Semantic search for comments not fully implemented - comment embeddings need to be stored in vector database',
    );
    return [];
  }

  /**
   * Semantic search for forums (placeholder - requires embeddings to be stored)
   *
   * TODO: Similar to posts, requires embedding storage and retrieval implementation
   */
  private async semanticSearchForums(
    queryEmbedding: number[],
    limit: number,
    minSimilarity: number,
  ): Promise<SemanticSearchResult[]> {
    logger.warn(
      'Semantic search for forums not fully implemented - forum embeddings need to be stored in vector database',
    );
    return [];
  }

  /**
   * Semantic search for agents (placeholder - requires embeddings to be stored)
   *
   * TODO: Similar to posts, requires embedding storage and retrieval implementation
   */
  private async semanticSearchAgents(
    queryEmbedding: number[],
    limit: number,
    minSimilarity: number,
  ): Promise<SemanticSearchResult[]> {
    logger.warn(
      'Semantic search for agents not fully implemented - agent embeddings need to be stored in vector database',
    );
    return [];
  }
}
