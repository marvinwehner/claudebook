import { Button } from "@heroui/react";

export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center gap-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Claudebook</h1>
        <p className="text-muted mt-1 text-sm">Scaffold is up.</p>
        <Button className="mt-4" variant="primary">
          Nothing here yet
        </Button>
      </div>
    </main>
  );
}
