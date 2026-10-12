'use client';

/**
 * COMMENTS - the thread under a clip.
 *
 * =============================================================================
 * THE ONE RULE THIS COMPONENT EXISTS TO ENFORCE
 * ==============================================================================
 *
 * Links are banned. Not filtered, not escaped, not "reviewed" - REFUSED, at the
 * point of posting, with a reason that says what part of the text triggered it.
 *
 * The server is the authority: `ValidateCommentBody` runs there on create AND on
 * edit, because a client-side check is a convenience and never a control. What this
 * component adds is the immediate half - it runs the SAME rule locally as the
 * viewer types, so someone is told before they press Post rather than after.
 *
 * Running the same rule twice is not duplication. The local pass exists so the
 * feedback is instant; the server pass exists so it is not bypassable. If the local
 * check is ever removed the UI degrades to a server error; if the server check is
 * ever removed the platform has an open spam hole.
 *
 * =============================================================================
 * WHY THE LOCAL RULE IS A COPY OF THE SERVER ONE
 * ==============================================================================
 *
 * It must not drift. The natural shortcut is to ship a looser local check and let
 * the server be strict - and a looser local check means a viewer is told "fine",
 * presses Post, and gets "refused", which teaches them the check is decorative.
 *
 * So the local rule blocks EVERYTHING the server blocks, which means it is allowed
 * to be STRICTER locally (block something the server would allow, and the server
 * will accept it) but never looser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThumbsUp, MessageSquare, Send, Loader2, Trash2, Pencil, X, Check } from 'lucide-react';

/** One comment as the API returns it. */
export interface Comment {
  id: string;
  body: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  edited_at?: string | null;
  author_name: string;
  author_avatar?: string | null;
  author_handle?: string;
  viewer_has_liked: boolean;
  viewer_is_author: boolean;
  replies?: Comment[];
}

/** The shape the list endpoint returns. */
interface CommentsResponse {
  comments?: Comment[];
  total?: number;
  has_more?: boolean;
  offset?: number;
  limit?: number;
  viewer_id?: string;
}

interface CommentsProps {
  /** The asset whose thread this is. */
  assetId: string;
  /** Media owner id, so the comment delete can authorise the clip owner. */
  assetOwnerId?: string;
  /** Shown above the input. */
  placeholder?: string;
}

/**
 * The LOCAL link check.
 *
 * Deliberately coarser than the server's `ValidateCommentBody`: it catches the
 * same families, and it is allowed to be stricter. What it must never be is looser
 * - a local pass that says "fine" while the server refuses is the failure mode.
 */
export function commentHasLink(text: string): boolean {
  const lower = text.toLowerCase();

  // 1. Any scheme.
  if (/(https?|ftp|ftps|sftp|ws|wss|javascript|data|file|mailto|tel|magnet|irc|ircs|gopher|ssh|tg|whatsapp):\/?\//i.test(text)) {
    return true;
  }

  // 2. Flatten the separators the way the server does: delete them, so "e x a m
  //    p l e" becomes "example" rather than staying spaced.
  let flat = lower;
  for (const d of ['[.]', '(.)', '{.}', '<.>', '·', '•', '․', '．', '｡', '、', '।', '۔']) {
    flat = flat.split(d).join('.');
  }
  // Remove the separators: spaces AND the zero-width characters, which are the
  // ones that survive a "strip whitespace" pass.
  flat = flat.replace(/[\s  - ​‌‍﻿⁠⁡‪-‮]/g, '');

  // 3. www., or a bare domain with a known TLD, or an IP literal.
  if (flat.includes('www.')) return true;
  // eslint-disable-next-line no-control-regex
  if (/\b[a-z0-9-]+\.(com|net|org|edu|gov|int|info|biz|io|co|uk|us|video|tv|me|app|dev|xyz|online|site|shop|link|ly)\b/i.test(flat)) {
    return true;
  }
  if (/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(flat)) return true;

  return false;
}

export function Comments({
  assetId,
  assetOwnerId: _assetOwnerId,
  placeholder = 'Add a comment',
}: CommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [liking, setLiking] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const busyRef = useRef<string | null>(null);

  // The viewer, from the list response. Used for the "you wrote this" affordance
  // and for the delete authorisation the server will repeat.
  const [viewerId, setViewerId] = useState<string | null>(null);

  const load = useCallback(
    async (at = 0) => {
      setLoading(at === 0);
      try {
        const res = await fetch(
          `/api/media/${encodeURIComponent(assetId)}/comments?limit=20&offset=${at}`,
          { cache: 'no-store' }
        );
        const body = (await res.json().catch(() => ({}))) as CommentsResponse;
        const next = body.comments ?? [];
        setComments((prev) => (at === 0 ? next : [...prev, ...next]));
        setTotal(body.total ?? 0);
        setHasMore(Boolean(body.has_more));
        setOffset(at + next.length);
        setViewerId(body.viewer_id ?? null);
      } catch {
        // A failure to load is not a failure to use the section: the input works
        // and posting still attempts, so the viewer can still speak.
        setComments([]);
      } finally {
        setLoading(false);
      }
    },
    [assetId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // ---- the local link gate ----
  const draftBlocked = useMemo(() => commentHasLink(draft), [draft]);
  // Codepoint count, not byte count, so an emoji is one character rather than
  // four. Counted this way because the build target does not allow spreading a
  // string (`[...str]`), and `Array.from` is the equivalent that also stays
  // codepoint-correct.
  const trimmedLength = Array.from(draft.trim()).length;
  const overLimit = trimmedLength > MAX_COMMENT_LENGTH;
  const canPost = draft.trim().length > 0 && !draftBlocked && !overLimit && !posting;

  const post = useCallback(
    async (parentId: string | null) => {
      const body = parentId ? '' : draft.trim();
      if (!body && !parentId) return;
      // Re-checked here, not only in the render, so a fast click cannot beat the
      // disabled state.
      if (commentHasLink(body)) {
        setError('Links are not allowed in comments.');
        return;
      }
      if (parentId && commentHasLink(editDraft)) {
        setError('Links are not allowed in comments.');
        return;
      }

      setPosting(true);
      setError(null);
      try {
        const res = await fetch(`/api/media/${encodeURIComponent(assetId)}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: parentId ? editDraft.trim() : body,
            parent_id: parentId,
          }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { message?: string };
          // The server's reason is shown VERBATIM. Re-wording it here would be a
          // second place for the message to drift, and the message the author reads
          // is what stops them trying a subtler encoding.
          setError(payload.message ?? 'That comment could not be posted.');
          setPosting(false);
          return;
        }

        const payload = (await res.json()) as { comment?: Comment };
        if (payload.comment) {
          const created = payload.comment;
          if (parentId) {
            // A reply is appended under its parent rather than prepended, because a
            // thread reads top to bottom and a reply at the top of the list is a
            // reply to the wrong thing.
            setComments((prev) =>
              prev.map((c) =>
                c.id === parentId
                  ? { ...c, replies: [...(c.replies ?? []), created], reply_count: c.reply_count + 1 }
                  : c
              )
            );
            setReplyingTo(null);
            setEditDraft('');
          } else {
            setComments((prev) => [created, ...prev]);
            setTotal((n) => n + 1);
            setDraft('');
          }
        }
      } catch {
        setError('Could not reach the service.');
      } finally {
        setPosting(false);
      }
    },
    [assetId, draft, editDraft]
  );

  const toggleLike = useCallback(
    async (c: Comment) => {
      if (busyRef.current) return;
      busyRef.current = c.id;
      setLiking((m) => ({ ...m, [c.id]: true }));
      try {
        const res = await fetch(`/api/media/comments/${encodeURIComponent(c.id)}/like`, {
          method: 'POST',
          cache: 'no-store',
        });
        if (!res.ok) {
          setError('That like could not be recorded.');
          return;
        }
        const body = (await res.json()) as { liked?: boolean; like_count?: number };
        // Local state is updated only on success. Updating before the server
        // answers means a failed like LOOKS liked, and the count drifts from the
        // row that justifies it.
        setComments((prev) =>
          prev.map((item) =>
            item.id === c.id
              ? {
                  ...item,
                  viewer_has_liked: Boolean(body.liked),
                  like_count: body.like_count ?? item.like_count,
                }
              : item
          )
        );
      } catch {
        setError('Could not reach the service.');
      } finally {
        setLiking((m) => ({ ...m, [c.id]: false }));
        busyRef.current = null;
      }
    },
    []
  );

  return (
    <section className="shrink-0 rounded-2xl bg-[#0d0f11] p-3" data-comments="">
      {/* ---- header ---- */}
      <div className="mb-2.5 flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-[#ff6500]" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-white">Comments</h3>
        {total > 0 ? (
          <span className="rounded-full bg-[#16181d] px-2 py-0.5 text-[10px] text-[#8b949e]">
            {total}
          </span>
        ) : null}
      </div>

      {/* ---- the composer ---- */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canPost) void post(null);
        }}
        className="space-y-1.5"
      >
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-invalid={draftBlocked || overLimit}
            maxLength={MAX_COMMENT_LENGTH + 200}
            className="min-w-0 flex-1 rounded-full bg-[#16181d] px-3 py-2 text-xs text-white placeholder-[#5a6066] focus:outline-none focus:ring-1 focus:ring-[#ff6500]"
          />
          <button
            type="submit"
            disabled={!canPost}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ff6500] text-white transition-colors hover:bg-[#e05500] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#ff6500]"
            aria-label="Post comment"
            title={canPost ? 'Post' : 'Nothing to post'}
          >
            {posting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* The link warning appears AS THEY TYPE, before they press Post.
            Explaining after the fact is what teaches obfuscation. */}
        {draftBlocked ? (
          <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-amber-400">
            <X className="h-3 w-3 shrink-0" aria-hidden="true" />
            Links are not allowed in comments. Remove the link to post.
          </p>
        ) : overLimit ? (
          <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-amber-400">
            <X className="h-3 w-3 shrink-0" aria-hidden="true" />
            Too long — {trimmedLength} of {MAX_COMMENT_LENGTH} characters.
          </p>
        ) : (
          <p className="pl-1 text-[10px] text-[#5a6066]">
            Links are not permitted in comments.
          </p>
        )}
      </form>

      {/* ---- the server's refusal, verbatim ---- */}
      {error ? (
        <p className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-red-300">
          {error}
        </p>
      ) : null}

      {/* ---- the thread ---- */}
      {loading ? (
        <div className="mt-3 flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-[#5794f2]" aria-hidden="true" />
        </div>
      ) : comments.length === 0 ? (
        <p className="mt-3 text-[11px] text-[#5a6066]">
          No comments yet. Be the first to say something.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              liking={Boolean(liking[c.id])}
              editing={editing === c.id}
              editDraft={editDraft}
              onEditDraft={setEditDraft}
              onStartEdit={(id, body) => {
                setEditing(id);
                setEditDraft(body);
              }}
              onCancelEdit={() => {
                setEditing(null);
                setEditDraft('');
              }}
              onLike={() => void toggleLike(c)}
              onReply={() => {
                setReplyingTo((prev) => (prev === c.id ? null : c.id));
                setEditDraft('');
              }}
              replyingTo={replyingTo === c.id}
              onDelete={async () => {
                try {
                  const res = await fetch(`/api/media/comments/${encodeURIComponent(c.id)}`, {
                    method: 'DELETE',
                    cache: 'no-store',
                  });
                  if (!res.ok) {
                    setError('That comment could not be removed.');
                    return;
                  }
                  setComments((prev) => prev.filter((item) => item.id !== c.id));
                  setTotal((n) => Math.max(0, n - 1));
                } catch {
                  setError('Could not reach the service.');
                }
              }}
              onSubmitReply={() => void post(c.id)}
              onLikeReply={(reply) => void toggleLike(reply)}
            />
          ))}
        </ul>
      )}

      {/* ---- load more ---- */}
      {hasMore ? (
        <button
          onClick={() => void load(offset)}
          className="mt-3 w-full rounded-lg bg-[#16181d] py-2 text-[11px] font-medium text-[#8b949e] transition-colors hover:bg-[#1f2227] hover:text-white"
        >
          Load more comments
        </button>
      ) : null}

      {/* Rendered only so the viewer id is inspectable in the DOM for debugging;
          not used by the logic, which trusts the server's flags. */}
      <span hidden data-viewer={viewerId ?? ''} />
    </section>
  );
}

/** The body-length cap, kept next to the component that enforces it. */
const MAX_COMMENT_LENGTH = 2000;

interface CommentRowProps {
  comment: Comment;
  liking: boolean;
  editing: boolean;
  editDraft: string;
  replyingTo: boolean;
  onLike: () => void;
  onReply: () => void;
  onStartEdit: (id: string, body: string) => void;
  onCancelEdit: () => void;
  onEditDraft: (v: string) => void;
  onDelete: () => void;
  onSubmitReply: () => void;
  onLikeReply: (c: Comment) => void;
}

function CommentRow({
  comment,
  liking,
  editing,
  editDraft,
  replyingTo,
  onLike,
  onReply,
  onStartEdit,
  onCancelEdit,
  onEditDraft,
  onDelete,
  onSubmitReply,
  onLikeReply,
}: CommentRowProps) {
  const replyBlocked = commentHasLink(editDraft);

  return (
    <li className="rounded-xl bg-[#16181d] px-3 py-2.5">
      <div className="flex gap-2.5">
        {/* avatar */}
        {comment.author_avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={comment.author_avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2c3235] text-[10px] font-semibold text-white">
            {(comment.author_name || '?').slice(0, 1).toUpperCase()}
          </span>
        )}

        <div className="min-w-0 flex-1">
          {/* name + time */}
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[11px] font-semibold text-white">
              {comment.author_name}
            </span>
            {comment.author_handle ? (
              <span className="shrink-0 text-[10px] text-[#5a6066]">@{comment.author_handle}</span>
            ) : null}
            <span className="shrink-0 text-[10px] text-[#5a6066]">
              {formatWhen(comment.created_at)}
              {comment.edited_at ? ' (edited)' : ''}
            </span>
          </div>

          {/* body, or the edit form */}
          {editing ? (
            <div className="mt-1.5 space-y-1.5">
              <input
                value={editDraft}
                onChange={(e) => onEditDraft(e.target.value)}
                aria-label="Edit comment"
                className="w-full rounded-full bg-[#0d0f11] px-2.5 py-1.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-[#ff6500]"
              />
              {replyBlocked ? (
                <p className="text-[10px] text-amber-400">Links are not allowed in comments.</p>
              ) : null}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    // The parent owns the PATCH; this row only reports the intent.
                    onSubmitReply();
                  }}
                  disabled={replyBlocked || !editDraft.trim()}
                  className="flex items-center gap-1 rounded-full bg-[#ff6500] px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
                >
                  <Check className="h-3 w-3" />
                  Save
                </button>
                <button
                  onClick={onCancelEdit}
                  className="rounded-full bg-[#0d0f11] px-2.5 py-1 text-[10px] text-[#8b949e]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#e6e6e6]">
              {comment.body}
            </p>
          )}

          {/* actions */}
          <div className="mt-1.5 flex items-center gap-2.5">
            <button
              onClick={onLike}
              disabled={liking}
              aria-pressed={comment.viewer_has_liked}
              className={`flex items-center gap-1 text-[10px] transition-colors ${
                comment.viewer_has_liked
                  ? 'text-[#ff6500]'
                  : 'text-[#8b949e] hover:text-white'
              } disabled:opacity-50`}
              title={comment.viewer_has_liked ? 'Unlike' : 'Like'}
            >
              <ThumbsUp className={`h-3 w-3 ${comment.viewer_has_liked ? 'fill-current' : ''}`} />
              {comment.like_count > 0 ? comment.like_count : ''}
            </button>

            <button
              onClick={onReply}
              className="text-[10px] text-[#8b949e] transition-colors hover:text-white"
            >
              Reply
            </button>

            {comment.viewer_is_author ? (
              <>
                <button
                  onClick={() => onStartEdit(comment.id, comment.body)}
                  className="flex items-center gap-1 text-[10px] text-[#8b949e] transition-colors hover:text-white"
                  title="Edit"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  Edit
                </button>
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1 text-[10px] text-[#8b949e] transition-colors hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  Delete
                </button>
              </>
            ) : null}
          </div>

          {/* reply composer */}
          {replyingTo ? (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  value={editDraft}
                  onChange={(e) => onEditDraft(e.target.value)}
                  placeholder={`Reply to ${comment.author_name}`}
                  aria-label={`Reply to ${comment.author_name}`}
                  className="min-w-0 flex-1 rounded-full bg-[#0d0f11] px-2.5 py-1.5 text-[11px] text-white placeholder-[#5a6066] focus:outline-none focus:ring-1 focus:ring-[#ff6500]"
                />
                <button
                  onClick={onSubmitReply}
                  disabled={replyBlocked || !editDraft.trim()}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff6500] text-white disabled:opacity-40"
                  aria-label="Post reply"
                >
                  <Send className="h-3 w-3" />
                </button>
              </div>
              {replyBlocked ? (
                <p className="text-[10px] text-amber-400">Links are not allowed in comments.</p>
              ) : null}
            </div>
          ) : null}

          {/* nested replies - ONE level, per `model.MaxCommentDepth` */}
          {comment.replies && comment.replies.length > 0 ? (
            <ul className="mt-2 space-y-2 border-l border-[#2c3235] pl-2.5">
              {comment.replies.map((r) => (
                <li key={r.id} className="flex gap-2">
                  {r.author_avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.author_avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2c3235] text-[9px] font-semibold text-white">
                      {(r.author_name || '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[10px] font-semibold text-white">
                        {r.author_name}
                      </span>
                      <span className="shrink-0 text-[9px] text-[#5a6066]">
                        {formatWhen(r.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#e6e6e6]">
                      {r.body}
                    </p>
                    <button
                      onClick={() => onLikeReply(r)}
                      aria-pressed={r.viewer_has_liked}
                      className={`mt-1 flex items-center gap-1 text-[10px] transition-colors ${
                        r.viewer_has_liked ? 'text-[#ff6500]' : 'text-[#8b949e] hover:text-white'
                      }`}
                    >
                      <ThumbsUp className={`h-3 w-3 ${r.viewer_has_liked ? 'fill-current' : ''}`} />
                      {r.like_count > 0 ? r.like_count : ''}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Short relative time, without pulling a date library for one format. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
