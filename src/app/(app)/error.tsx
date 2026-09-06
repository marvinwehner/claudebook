"use client";

import { TriangleExclamation } from "@gravity-ui/icons";
import { Button, Card } from "@heroui/react";
import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Not rendered: a server error's message can carry internals.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="border-border w-full max-w-sm border border-dashed p-10 text-center">
        <div className="bg-surface-secondary text-muted mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl">
          <TriangleExclamation aria-hidden className="size-5" />
        </div>
        <p className="font-medium">Something went wrong</p>
        <p className="text-muted mx-auto mt-1 max-w-sm text-sm">
          Sorry — this page could not be loaded. Trying again often fixes it.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <Button variant="primary" onPress={() => retry()}>
            Try again
          </Button>
          <Link href="/" className="text-muted hover:text-foreground text-sm">
            Back to notebooks
          </Link>
        </div>
      </Card>
    </main>
  );
}
