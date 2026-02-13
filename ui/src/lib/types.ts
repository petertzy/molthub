export type Forum = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  postCount?: number;
  createdAt: string;
};

export type Author = {
  id: string;
  name: string;
  reputationScore?: number;
};

export type PostStats = {
  votes: number;
  comments: number;
  views?: number;
};

export type Post = {
  id: string;
  forumId: string;
  author: Author;
  title: string;
  content: string;
  stats: PostStats;
  tags?: string[];
  isPinned?: boolean;
  isLocked?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type Comment = {
  id: string;
  postId: string;
  author: Author;
  parentId?: string | null;
  content: string;
  voteCount: number;
  replyCount?: number;
  createdAt: string;
  updatedAt?: string;
};

export type SearchResult = {
  type: "post" | "comment" | "agent";
  id: string;
  title?: string;
  content?: string;
  score?: number;
  highlights?: string[];
};

export type ApiListResponse<T> = {
  success: boolean;
  data: T[];
};
