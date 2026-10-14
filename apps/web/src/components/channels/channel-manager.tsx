'use client';

/**
 * CHANNEL MANAGER  -  edit / cover / visibility / delete
 *
 * ---- WHY THE HANDLE IS NOT EDITABLE ----
 * `handle` is the channel's permanent public URL (`/@handle`). Changing it
 * would break every existing link, embed, bookmark and share pointing at
 * this channel, and there is no redirect mapping to soften that. So the
 * backend does not accept `handle` in the update request at all, and this
 * UI shows it as read-only text explaining why. Making it look editable
 * and then failing server-side would be worse than saying so up front.
 *
 * ---- WHY PARTIAL PATCHES ----
 * `saveEdits` sends ONLY the fields that changed, because the backend uses
 * pointer fields: a missing key means "leave it alone", while an explicit
 * `""` or `false` is a real value to set. Sending the whole object every
 * time would work too, but it means a stale tab could silently overwrite a
 * change made elsewhere - a lost-update problem.
 *
 * Hinglish: handle permanent hai, baaki sab editable
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { CoverUploader } from '@/components/channels/cover-uploader';

import {
  grafanaBg,
  grafanaPrimary,
  grafanaPrimaryBg,
  grafanaText,
  grafanaTextMuted,
  productPanelHover,
  productSeparation,
  productSunken,
  productTextNeutral,
} from '@wideo11/ui/design-system';

export type ManagedChannel = {
  id: string;
  handle: string;
  display_name: string;
  description: string;
  image_url: string;
  cover_url: string;
  is_public: boolean;
  is_active: boolean;
  created_at: string;
};

type Props = {
  channel: ManagedChannel;
  onChanged: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
};

const DISPLAY_NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;

export function ChannelManager({ channel, onChanged, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Local edit buffer. Initialised from the channel, refreshed whenever the
  // panel opens so an external change is not silently overwritten in the UI.
  const [displayName, setDisplayName] = useState(channel.display_name);
  const [description, setDescription] = useState(channel.description);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setDisplayName(channel.display_name);
      setDescription(channel.description);
      setError(null);
      setOk(null);
      setConfirmingDelete(false);
    }
  }, [open, channel.display_name, channel.description]);

  const flash = useCallback((message: string) => {
    setOk(message);
    setError(null);
    window.setTimeout(() => setOk(null), 4000);
  }, []);

  /** Save ONLY the fields that actually differ from the server state. */
  const saveEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);

    const name = displayName.trim();
    if (name.length < 1 || name.length > DISPLAY_NAME_MAX) {
      setError(`Display name must be 1-${DISPLAY_NAME_MAX} characters.`);
      return;
    }
    const desc = description.trim();
    if (desc.length > DESCRIPTION_MAX) {
      setError(`Description must be ${DESCRIPTION_MAX} characters or fewer.`);
      return;
    }

    // Build a PATCH body containing only real changes. Sending fields that
    // did not change is harmless, but sending NOTHING would be a wasted
    // round trip and would make the success message a lie.
    const body: Record<string, string> = {};
    if (name !== channel.display_name) body.display_name = name;
    if (desc !== channel.description) body.description = desc;
    if (Object.keys(body).length === 0) {
      setOk('Nothing to save.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? 'Could not save changes.');
        return;
      }
      await onChanged();
      flash('Channel updated.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  /** Toggle public/private. */
  const toggleVisibility = async () => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: !channel.is_public }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? 'Could not change visibility.');
        return;
      }
      await onChanged();
      flash(channel.is_public ? 'Channel is now private.' : 'Channel is now public.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message ?? data?.error ?? 'Could not delete channel.');
        setBusy(false);
        return;
      }
      await onDeleted();
    } catch {
      setError('Network error. Please try again.');
      setBusy(false);
    }
  };

  return (
    <li className={`rounded-md ${productSunken} p-4`}>
      <div className="flex flex-wrap items-start gap-3">
        {/* 16:9 cover thumbnail */}
        <div className={`aspect-video w-40 shrink-0 overflow-hidden rounded-md ${grafanaBg}`}>
          {channel.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={channel.cover_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className={`flex h-full w-full items-center justify-center text-[10px] ${grafanaTextMuted}`}>
              No cover
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`truncate text-sm font-semibold ${grafanaText}`}>
              {channel.display_name}
            </h3>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                channel.is_public
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : `${productSeparation} ${grafanaTextMuted}`
              }`}
            >
              {channel.is_public ? 'Public' : 'Private'}
            </span>
          </div>

          {/* Handle is read-only on purpose - see the file header. */}
          <p className={`mt-0.5 text-[11px] ${grafanaTextMuted}`}>
            @{channel.handle}
            <span className={`ml-1 ${productTextNeutral}`}>(permanent URL)</span>
          </p>

          {channel.description ? (
            <p className={`mt-1 line-clamp-2 text-xs ${grafanaTextMuted}`}>
              {channel.description}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={`h-8 ${productPanelHover} px-2.5 text-xs ${grafanaText} hover:${productSeparation}`}
            >
              {open ? (
                <X className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
              ) : (
                <Pencil className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
              )}
              {open ? 'Close' : 'Edit'}
            </Button>

            <Button
              type="button"
              onClick={toggleVisibility}
              disabled={busy}
              className={`h-8 ${productPanelHover} px-2.5 text-xs ${grafanaText} hover:${productSeparation}`}
            >
              {channel.is_public ? (
                <EyeOff className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
              ) : (
                <Eye className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
              )}
              {channel.is_public ? 'Make private' : 'Make public'}
            </Button>

            {!confirmingDelete ? (
              <Button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className={`h-8 ${productPanelHover} px-2.5 text-xs text-red-400 hover:${productSeparation}`}
              >
                <Trash2 className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
                Delete
              </Button>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className={`text-[11px] ${grafanaTextMuted}`}>Sure?</span>
                <Button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="h-8 bg-red-600 px-2.5 text-xs text-white hover:bg-red-500"
                >
                  {busy ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
                  ) : (
                    'Yes, delete'
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className={`h-8 ${productPanelHover} px-2.5 text-xs ${grafanaText} hover:${productSeparation}`}
                >
                  Cancel
                </Button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ---- Inline editor (no modal) - matches the create-form pattern ---- */}
      {open ? (
        <div className="mt-4 space-y-4 pt-4">
          {error ? (
            <p className="flex items-start gap-1.5 text-[11px] text-red-400">
              <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          ) : null}
          {ok ? (
            <p className="flex items-start gap-1.5 text-[11px] text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span>{ok}</span>
            </p>
          ) : null}

          <form onSubmit={saveEdits} className="space-y-3">
            <div>
              <label
                htmlFor={`display-name-${channel.id}`}
                className={`mb-1 block text-[11px] font-medium ${grafanaTextMuted}`}
              >
                Display name
              </label>
              <Input
                id={`display-name-${channel.id}`}
                value={displayName}
                maxLength={DISPLAY_NAME_MAX}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`h-9 ${grafanaBg} ${grafanaText}`}
              />
            </div>

            <div>
              <label
                htmlFor={`description-${channel.id}`}
                className={`mb-1 block text-[11px] font-medium ${grafanaTextMuted}`}
              >
                Description
              </label>
              <textarea
                id={`description-${channel.id}`}
                value={description}
                maxLength={DESCRIPTION_MAX}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
                className={`w-full rounded-md ${grafanaBg} p-2 text-sm ${grafanaText} outline-none focus:${grafanaPrimary} focus:ring-2 focus:ring-[#5794f2]/30`}
              />
              <p className={`mt-0.5 text-[10px] ${productTextNeutral}`}>
                {description.length}/{DESCRIPTION_MAX}
              </p>
            </div>

            <Button
              type="submit"
              disabled={busy}
              className={`h-9 w-full ${grafanaPrimaryBg} text-sm text-white ${grafanaPrimaryBg}/85`}
            >
              {busy ? (
                <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" aria-hidden="true" />
              ) : (
                'Save changes'
              )}
            </Button>
          </form>

          <div>
            <p className={`mb-2 text-[11px] font-medium ${grafanaTextMuted}`}>
              Cover image
            </p>
            <CoverUploader
              channelId={channel.id}
              currentUrl={channel.cover_url || undefined}
              onUploaded={onChanged}
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default ChannelManager;

