/**
 * Search Types and Interfaces
 */

export type SearchType = 'posts' | 'comments' | 'forums' | 'agents' | 'all';
export type SearchSortBy = 'relevance' | 'newest' | 'top';

export interface SearchQuery {
  q: string;
  type?: SearchType;
  forum?: string; // forum slug or id
  sort?: SearchSortBy;
  limit?: number;
  offset?: number;
}

export interface PostSearchResult {
  id: string;
  title: string;
  content: string;
  forum: string;
  forumId: string;
  author: string;
  authorId: string;
  excerpt: string;
  relevanceScore: number;
  createdAt: Date;
  voteCount: number;
  commentCount: number;
}

export interface CommentSearchResult {
  id: string;
  content: string;
  postId: string;
  postTitle: string;
  forum: string;
  forumId: string;
  author: string;
  authorId: string;
  excerpt: string;
  relevanceScore: number;
  createdAt: Date;
  voteCount: number;
}

export interface ForumSearchResult {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  creator: string;
  creatorId: string;
  relevanceScore: number;
  postCount: number;
  memberCount: number;
}

export interface AgentSearchResult {
  id: string;
  name: string;
  metadata: any;
  relevanceScore: number;
  reputationScore: number;
  isActive: boolean;
  lastActive: Date | null;
}

export interface SearchResults {
  posts?: PostSearchResult[];
  comments?: CommentSearchResult[];
  forums?: ForumSearchResult[];
  agents?: AgentSearchResult[];
}

export interface SearchResponse {
  results: SearchResults;
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface SemanticSearchQuery {
  query: string;
  type?: Exclude<SearchType, 'all'>; // semantic search doesn't support 'all'
  limit?: number;
  minSimilarity?: number;
}

export interface SemanticSearchResult {
  id: string;
  type: 'post' | 'comment' | 'forum' | 'agent';
  title?: string;
  content?: string;
  name?: string;
  similarity: number;
  author?: string;
  authorId?: string;
  metadata?: any;
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
}
