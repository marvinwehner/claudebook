"use client";

import { PersonPlus, TrashBin } from "@gravity-ui/icons";
import { Button, Input, Label, Modal, Separator, Spinner, TextField } from "@heroui/react";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api/client";
import type { Access } from "@/lib/auth/allowlist-service";
import { formatDate } from "@/lib/format";

/**
 * Who may sign in. Admin only — the menu hides the entry, and every request
 * behind it goes through `requireAdmin()` regardless.
 *
 * The open state lives on the Backdrop rather than on the Modal root. The root
 * is React Aria's DialogTrigger, whose PressResponder merges the trigger's
 * onPress into every pressable beneath it — including Invite and Remove, whose
 * failures render inside this dialog and would otherwise be closed away before
 * they could be read. `notebook-settings`' delete confirm does the same.
 */
export function AllowedUsersDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Allowed users</Modal.Heading>
            </Modal.Header>
            {/* Rendered by the overlay only while open, so its mount effect is
                the refresh: reopening the dialog refetches. */}
            <AccessPanel onDone={() => onOpenChange(false)} />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function AccessPanel({ onDone }: { onDone: () => void }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listAccess()
      .then((next) => {
        if (!cancelled) setAccess(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : "Could not load the list.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function inviteUser() {
    setBusy(true);
    setError(null);
    try {
      const { allowedUser } = await api.inviteUser(email);
      setAccess((current) =>
        current ? { ...current, invited: [allowedUser, ...current.invited] } : current,
      );
      setEmail("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not invite that address.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeUser(address: string) {
    const previous = access;
    setError(null);
    setAccess((current) =>
      current
        ? { ...current, invited: current.invited.filter((user) => user.email !== address) }
        : current,
    );
    try {
      await api.revokeUser(address);
    } catch {
      setAccess(previous);
      setError(`Could not remove ${address}.`);
    }
  }

  return (
    <>
      <Modal.Body className="flex flex-col gap-4">
        <TextField
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="off"
          isDisabled={!access}
        >
          <Label>Invite someone</Label>
          <div className="flex items-end gap-2">
            <Input placeholder="name@example.com" className="flex-1" />
            <Button
              variant="primary"
              isDisabled={!email.trim() || !access}
              isPending={busy}
              onPress={inviteUser}
            >
              <PersonPlus aria-hidden />
              Invite
            </Button>
          </div>
        </TextField>

        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}

        {access ? (
          <>
            {/* Admins come from ADMIN_EMAILS and are not rows in the database, so
                they cannot be removed here — but leaving them out entirely would
                make this list a half-truth about who can sign in. */}
            <section>
              <h3 className="text-muted mb-2 text-xs font-medium tracking-wide uppercase">
                Admins
              </h3>
              <ul className="flex flex-col gap-1">
                {access.admins.map((address) => (
                  <li key={address} className="flex items-center justify-between py-1 text-sm">
                    <span className="truncate">{address}</span>
                    <span className="text-muted shrink-0 text-xs">Set in the environment</span>
                  </li>
                ))}
              </ul>
            </section>

            <Separator />

            <section>
              <h3 className="text-muted mb-2 text-xs font-medium tracking-wide uppercase">
                Invited
              </h3>
              {access.invited.length === 0 ? (
                <p className="text-muted text-sm">
                  Nobody yet. An invited address can sign in with Google straight away — exactly the
                  address, as Google reports it.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {access.invited.map((user) => (
                    <li key={user.email} className="flex items-center justify-between gap-2 py-1">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{user.email}</p>
                        <p className="text-muted truncate text-xs">
                          Invited by {user.invitedByEmail} &middot; {formatDate(user.createdAt)}
                        </p>
                      </div>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${user.email}`}
                        onPress={() => revokeUser(user.email)}
                      >
                        <TrashBin aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : error ? null : (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="tertiary" onPress={onDone}>
          Done
        </Button>
      </Modal.Footer>
    </>
  );
}
