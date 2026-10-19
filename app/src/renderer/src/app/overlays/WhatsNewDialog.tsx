import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useUi } from "@/state/ui";
import { WHATS_NEW_VERSION, saveWhatsNewSeen } from "@/state/whats-new";
import stems from "@/assets/whats-new/stems.webp";
import toneMatch from "@/assets/whats-new/tone-match.webp";
import search from "@/assets/whats-new/search.webp";

const SLIDES = [
  { title: "Pick the stem separation model", text: "Before the first split, choose a model (Standard, Best or Fine-tuned) and a quality (Fast, Balanced or Max). Models download, resume and delete from the same picker.", image: stems },
  { title: "Tone match builds a SnapTone", text: "Your downloaded NAM captures are ranked against the song's guitar. Build the SnapTone with a cab IR designed for that song; nothing is written until you press Write.", image: toneMatch },
  { title: "Search TONE3000 in the app", text: "A new Search tab with gear, architecture and sort filters. Browse is still there as a fallback.", image: search },
];

/** Help › What's new: a scroll-snap carousel of the release's headline features. Opens once after an upgrade (app/whats-new.ts). */
export function WhatsNewDialog() {
  const open = useUi((s) => s.whatsNewOpen);
  const setOpen = useUi((s) => s.setWhatsNewOpen);
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);
  const goTo = (i: number) => track.current?.children[i]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  const onScroll = () => {
    const el = track.current;
    if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) saveWhatsNewSeen();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[720px] max-w-[calc(100vw-48px)] gap-4 sm:max-w-[720px]">
        <DialogTitle className="text-lg font-semibold tracking-[-0.012em]">What's new in {WHATS_NEW_VERSION}</DialogTitle>
        <DialogDescription className="sr-only">Highlights of this release.</DialogDescription>
        <div className="relative">
          <div ref={track} onScroll={onScroll} className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SLIDES.map((s, i) => (
              <section key={s.title} aria-label={`${i + 1} of ${SLIDES.length}`} className="flex w-full shrink-0 snap-start flex-col gap-3">
                <img src={s.image} alt="" className="aspect-[3/2] max-h-[max(120px,calc(100vh-270px))] w-full rounded-sm border border-white/10 object-cover object-top" />
                <h3 className="text-[15px] font-semibold">{s.title}</h3>
                <p className="text-[13px] text-pretty text-silkscreen-2">{s.text}</p>
              </section>
            ))}
          </div>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous" disabled={index === 0} onClick={() => goTo(index - 1)}>
              <ChevronLeft />
            </Button>
            {SLIDES.map((s, i) => (
              <button key={s.title} type="button" aria-label={`Slide ${i + 1}`} aria-current={i === index} onClick={() => goTo(i)} className="grid size-5 place-items-center">
                <span className={`size-2 rounded-full ${i === index ? "bg-brand" : "bg-white/25"}`} />
              </button>
            ))}
            <Button variant="ghost" size="icon" aria-label="Next" disabled={index === SLIDES.length - 1} onClick={() => goTo(index + 1)}>
              <ChevronRight />
            </Button>
          </div>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
