"use client";

import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { shortenAddressesIn } from "@/lib/format";

/**
 * Something an action could not do, said in the app's own dialog instead of as red text wherever the button happens to sit (a
 * header, a card). Names what failed in the title, says why in `message` (full addresses shortened) and offers one way out.
 */
export function ProblemDialog({ title, message, onClose, action }: { title: string; message: string; onClose: () => void; action?: { label: string; onClick: () => void } }) {
  return (
    <Overlay title={title} onClose={onClose}>
      <p role="alert" className="text-graphite">{shortenAddressesIn(message)}</p>
      <Overlay.Footer>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {action ? <Button onClick={() => { onClose(); action.onClick(); }}>{action.label}</Button> : null}
      </Overlay.Footer>
    </Overlay>
  );
}
