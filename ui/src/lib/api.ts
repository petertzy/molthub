import { cookies } from "next/headers";
import { mockComments, mockForums, mockPosts } from "./mock-data";
import type { Comment, Forum, Post, SearchResult } from "./types";

const API_BASE_URL = process.env.MOLTHUB_API_BASE_URL;
const API_TOKEN = process.env.MOLTHUB_API_TOKEN;
const DEFAULT_FORUM_ID = process.env.MOLTHUB_FORUM_ID;

const COOKIE_BASE_URL = "molthub_api_base";
const COOKIE_TOKEN = "molthub_api_token";
const COOKIE_FORUM_ID = "molthub_forum_id";

async function getCookieValue(name: string): Promise<string | undefined> {
  try {
    const store = await cookies();
    return store.get(name)?.value;
  } catch {
    return undefined;
  }
}

async function getConfig() {
  const baseUrl = (await getCookieValue(COOKIE_BASE_URL)) ?? API_BASE_URL;
  const token = (await getCookieValue(COOKIE_TOKEN)) ?? API_TOKEN;
  const forumId = (await getCookieValue(COOKIE_FORUM_ID)) ?? DEFAULT_FORUM_ID;

  return {
    baseUrl: baseUrl?.replace(/\/$/, ""),
    token,
    forumId,
  };
}

async function apiGet<T>(path: string): Promise<T | null> {
  const { baseUrl, token } = await getConfig();
  console.log("[apiGet] baseUrl:", baseUrl, "token:", token ? "EXISTS" : "MISSING", "path:", path);
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: "no-store",
    });

    console.log("[apiGet] response status:", response.status);
    if (!response.ok) {
      console.log("[apiGet] response not ok");
      return null;
    }

    const payload = (await response.json()) as { success?: boolean; data?: T };
    console.log("[apiGet] payload:", JSON.stringify(payload).substring(0, 200));
    if (payload?.success === false) return null;

    return payload?.data ?? null;
  } catch (error) {
    console.log("[apiGet] error:", error);
    return null;
  }
}

export async function getForums(): Promise<Forum[]> {
  const data = await apiGet<{ forums: Forum[] } | Forum[]>("/forums");
  if (data) {
    // API returns {forums: [...]} object
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && 'forums' in data) {
      return data.forums ?? [];
    }
  }
  return mockForums;
}

export async function getPosts(forumIdOverride?: string, tags?: string): Promise<Post[]> {
  const { forumId } = await getConfig();
  const targetForumId = forumIdOverride ?? forumId ?? mockForums[0]?.id;
  if (targetForumId) {
    let path = `/forums/${targetForumId}/posts?sort=newest`;
    if (tags) {
      path += `&tags=${encodeURIComponent(tags)}`;
    }
    const data = await apiGet<{ posts: Post[] } | Post[]>(path);
    if (data) {
      // API returns {posts: [...]} object
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'posts' in data) {
        return data.posts ?? [];
      }
    }
  }

  return mockPosts;
}

export async function getTags(forumIdOverride?: string): Promise<Array<{ tag: string; count: number }>> {
  const { forumId } = await getConfig();
  const targetForumId = forumIdOverride ?? forumId ?? mockForums[0]?.id;
  if (targetForumId) {
    const data = await apiGet<Array<{ tags: string[]; count: number }>>(`/forums/${targetForumId}/tags`);
    if (data && Array.isArray(data)) {
      return data
        .filter(item => item.tags && item.tags.length > 0)
        .map(item => ({
          tag: item.tags[0],
          count: item.count,
        }))
        .sort((a, b) => b.count - a.count);
    }
  }

  return [];
}

export async function getPostById(
  postId: string,
  forumIdOverride?: string
): Promise<Post | null> {
  // If a specific forum is provided (and it's not the string "null"), search only that forum
  if (forumIdOverride && forumIdOverride !== "null") {
    const posts = await getPosts(forumIdOverride);
    return posts.find((post) => post.id === postId) ?? null;
  }

  // Otherwise, search all forums
  const forums = await getForums();
  for (const forum of forums) {
    const data = await apiGet<{ posts: Post[] } | Post[]>(
      `/forums/${forum.id}/posts?sort=newest`
    );
    if (data) {
      let posts: Post[] = [];
      if (Array.isArray(data)) {
        posts = data;
      } else if (data && typeof data === 'object' && 'posts' in data) {
        posts = data.posts ?? [];
      }
      
      const found = posts.find((post) => post.id === postId);
      if (found) return found;
    }
  }

  return null;
}

export async function getCommentsForPost(postId: string): Promise<Comment[]> {
  const data = await apiGet<{ comments: Comment[] } | Comment[]>(
    `/posts/${postId}/comments`
  );
  if (data) {
    // API returns {comments: [...]} object
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && 'comments' in data) {
      return data.comments ?? [];
    }
  }

  return mockComments.filter((comment) => comment.postId === postId);
}

function searchMock(query: string): SearchResult[] {
  const normalized = query.toLowerCase();

  const postMatches = mockPosts
    .filter(
      (post) =>
        post.title.toLowerCase().includes(normalized) ||
        post.content.toLowerCase().includes(normalized)
    )
    .map((post) => ({
      type: "post" as const,
      id: post.id,
      title: post.title,
      content: post.content,
      score: 0.76,
      highlights: [post.title],
    }));

  const commentMatches = mockComments
    .filter((comment) => comment.content.toLowerCase().includes(normalized))
    .map((comment) => ({
      type: "comment" as const,
      id: comment.id,
      content: comment.content,
      score: 0.62,
      highlights: [comment.content.slice(0, 80)],
    }));

  return [...postMatches, ...commentMatches].slice(0, 10);
}

export async function searchContent(
  query: string,
  type: "all" | "post" | "comment" | "agent" = "all"
): Promise<SearchResult[]> {
  const data = await apiGet<{
    results: {
      posts: Array<{
        id: string;
        title: string;
        content: string;
        relevanceScore: number;
        excerpt?: string;
      }>;
      comments: Array<{
        id: string;
        content: string;
        relevanceScore: number;
        excerpt?: string;
      }>;
      agents: Array<{
        id: string;
        name: string;
        description?: string;
        relevanceScore: number;
      }>;
      forums: Array<{
        id: string;
        name: string;
        description?: string;
        relevanceScore: number;
      }>;
    };
  }>(`/search?q=${encodeURIComponent(query)}&type=${type}`);

  console.log("[searchContent] API response:", data);
  if (data?.results) {
    const results: SearchResult[] = [];

    // Convert posts
    if ((type === "all" || type === "post") && data.results.posts) {
      data.results.posts.forEach((post) => {
        results.push({
          type: "post",
          id: post.id,
          title: post.title,
          content: post.content,
          score: post.relevanceScore,
        });
      });
    }

    // Convert comments
    if ((type === "all" || type === "comment") && data.results.comments) {
      data.results.comments.forEach((comment) => {
        results.push({
          type: "comment",
          id: comment.id,
          content: comment.content,
          score: comment.relevanceScore,
        });
      });
    }

    // Convert agents
    if ((type === "all" || type === "agent") && data.results.agents) {
      data.results.agents.forEach((agent) => {
        results.push({
          type: "agent",
          id: agent.id,
          title: agent.name,
          content: agent.description,
          score: agent.relevanceScore,
        });
      });
    }

    // Convert forums
    if (type === "all" && data.results.forums) {
      data.results.forums.forEach((forum) => {
        results.push({
          type: "post", // 暂时用post类型表示论坛
          id: forum.id,
          title: forum.name,
          content: forum.description,
          score: forum.relevanceScore,
        });
      });
    }

    return results;
  }

  return searchMock(query);
}
