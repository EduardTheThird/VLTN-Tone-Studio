import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useUi } from "@/state/ui";
import { WHATS_NEW_VERSION, saveWhatsNewSeen } from "@/state/whats-new";
import songLibrary from "@/assets/whats-new/song-library.webp";
import stemMixer from "@/assets/whats-new/stem-mixer.webp";
import band from "@/assets/whats-new/band.webp";
import rigTools from "@/assets/whats-new/rig-tools.webp";
import midiCues from "@/assets/whats-new/midi-cues.webp";
import stageMode from "@/assets/whats-new/stage-mode.webp";
import soloScales from "@/assets/whats-new/solo-scales.webp";
import { host } from "@/host";

interface Slide {
  title: string;
  text: string;
  image: string;
  /** A contributor to thank under the slide: a GitHub handle and what they did. */
  credit?: { handle: string; note: string };
}

const SLIDES: Slide[] = [
  {
    title: "Held bass notes ring and decay",
    text: "Update the generated bass to hear Fingers and Pick notes ring for their written duration and fade like the original recordings. Ghost notes and releases stay short.",
    image: band,
  },
  {
    title: "Style drums for basic beats",
    text: "If a new song’s drum stem is a basic beat, Band defaults to From the style so you still get fills and variation. Choose From the original drummer to copy the beat.",
    image: band,
  },
  {
    title: "Drums that follow the original",
    text: "In Band, let generated drums learn the song’s rhythm from the original drum stem. Engine 4 also adds grooves, fills and feel measured from recordings of drummers. Preview each section’s busyness and loudness on the pad, copy its settings or lock its notes.",
    image: band,
  },
  {
    title: "Fingers and pick bass",
    text: "Choose Fingers or Pick for a different recorded bass. Both reach low B and play short and ghost notes from samples. Set each section’s bass articulation and whether the line can jump octaves.",
    image: band,
  },
  {
    title: "Change the band live",
    text: "Enable live band changes for a song and update its parts. In Stage mode or from an assigned key or footswitch, call Lift, Soft, Drums only or Band out. The change lands at the next bar.",
    image: stageMode,
  },
  {
    title: "Keys, synth and percussion",
    text: "Add piano, electric piano or organ that follows the chord chart. Set synth pads, stabs or pulses and try a synth bass voice. Add tambourine, shaker, claps or cowbell to individual sections.",
    image: stemMixer,
  },
  {
    title: "Name presets and plan your rig",
    text: "Name TimeLine, SY-200 and IR-200 presets, then choose them by section in a song’s Rig table. In My rig, test recall and tempo, check channels and print a setup sheet. Stage shows the last known pedal state and offers Reset rig and Solo.",
    image: rigTools,
  },
  {
    title: "RC-10R clock, breaks and memory review",
    text: "Send MIDI clock from the song’s recorded beats so synced pedals can follow tempo changes. Add RC-10R breaks and section levels to a cue draft. Save rhythm memory choices with a song and compare them against a pedal backup.",
    image: midiCues,
  },
  {
    title: "Rename SnapTones and IRs on the GP-200",
    text: "In Tones, under On your GP-200, right-click a filled SnapTone or User IR slot and pick Rename. Names can be up to 15 characters. The app reads the name back from the pedal to check it, and a linked TONE3000 tone keeps its link. GP-150 users: preset numbers now stay right after you overwrite presets, so the Rig arrows step through them in order.",
    image: rigTools,
  },
  {
    title: "Pedal drums, with a backup",
    text: "In This song, open What plays and set drums to RC-10R pedal. Pick a fallback too, generated or original. When you press Play, the pedal plays only if the song has RC-10R cues and Send cues is on with an output connected. Otherwise the fallback drums play and a toast tells you why. A drums chip on the transport and in stage mode shows what plays. The old \"Use pedal drums in every song\" switch is gone. Songs with RC-10R cues were moved to pedal drums, keeping their previous drums as the fallback. The MIDI view has one RC-10R drums card with a ready checklist.",
    image: band,
  },
  {
    title: "Safer screens",
    text: "If a problem happens in one screen or view, you now get Reload screen instead of a blank window. Opening This song no longer blanks the window.",
    image: stageMode,
  },
  {
    title: "Upload NAM models to your GP-150/GP-180",
    text: "In Tones, open the NAM slots and choose Upload NAM on a slot to put an A2 Lite .nam file on the pedal. The app converts it, asks before it replaces the slot, and reads the list back to check the new name. The model you replace can't be read back from the pedal, so keep your own copy. Other NAM types are refused before anything is sent.",
    image: rigTools,
  },
  {
    title: "Small fixes for the stage",
    text: "If a hard ending is chosen while the original tracks still fade out, the Band dialog now tells you. Cancelling a jump after a vamp's exit bar has started lets the exit finish. If the window can't reload after a crash, you get Reload or Quit instead of a blank window.",
    image: band,
  },
  {
    title: "Tighter repeat cues and lighter loading",
    text: "Repeat and jump destination MIDI state is queued ahead with the audio boundary’s timestamp. The scheduler measures its clock alignment before use. Library tracks decode straight into playback storage in reusable chunks, reducing temporary audio copies while keeping per-track mixing, sample access and early preparation for the next song.",
    image: midiCues,
  },
  {
    title: "The correct native NAM slot count",
    text: "GP-150/GP-180 native NAM management has 20 selectable slots, separate from the converted SnapTone bank. Tones now excludes the extra empty records in the pedal’s name reply and refuses renames outside slots 1–20. Read and rename NAM slots or switch the preset’s mode in Tones. Save the preset to keep its mode. NAM file upload remains unavailable.",
    image: rigTools,
  },
  {
    title: "Less memory across your set",
    text: "Long sets release unused preloaded audio after transitions and keep fewer duplicate copies of each track. Song loading has lower memory peaks. Per-track mixing, practice mute, speed and pitch changes remain available, and the next song still prepares ahead for crossfades.",
    image: band,
  },
  {
    title: "Reliable starts and saved band parts",
    text: "Opening a song keeps its saved drums, bass and drummer grid. Play uses the existing parts without waiting for a band render or save; musical edits update parts in the background while stopped. Before song preparation is off unless enabled, and songs with no setup commands can keep gapless transitions. Drum kits share decoded samples, layer blends avoid unintended boosts, and older dry settings stay dry. Existing rendered audio stays as saved until regenerated.",
    image: band,
  },
  {
    title: "Send drums to your RC-10R",
    text: "On macOS, open the Band panel’s RC-10R export dialog and connect the pedal by USB. Tone Studio detects it and enables Send to RC-10R… (beta). Choose a User rhythm, back up the complete pedal, review the replacement and send. Other rhythms stay intact. Kit and tempo can also be saved for one phrase memory. Interrupted transfers have backup recovery. Check the pedal’s six parts and save its phrase memory before confirming the transfer; pedal and listening checks are still pending.",
    image: band,
  },
  {
    title: "Bring your set up to date",
    text: "In Songs & playlists, select a playlist and open Playlist menu… → Bring this set up to date…. Back up first, then update older generated drums and bass in one run. You can switch clean bass to Warm and add the pedal's names to GP-150/GP-180 cue labels. Your rendered parts, bass notes and bar marks stay yours. Each song is saved before moving on; a missing tone skips the song. The playlist check and per-song reminders help you choose the musical details before rehearsal.",
    image: band,
  },
  {
    title: "A song library and live sets",
    text: "Save a song with its stems, chart, tempo, key and mix, then put songs in playlists and sets. A set plays from one song to the next with crossfades or gapless joins, a queue shows what comes next, and the playlist check flags songs with missing band tones. A library backup takes everything with it.",
    image: songLibrary,
  },
  {
    title: "Play along with the stems",
    text: "A split song plays in a mixer with solo, level and output for each stem, under a transport bar and a timeline you can click or drag to seek. Add a metronome and a count-in, jump to or loop a section, change the speed or the key, and turn on Practice mute to take your own part out of every song.",
    image: stemMixer,
  },
  {
    title: "A band behind you",
    text: "The Band panel finds the beat and writes drums that play in four-bar phrases, with fills sized to each change, and bass that follow the song's chords and sections, in tabs for each part. The bass plays repeating figures with a warm built-in tone, drums can end on a hit, a fill and hold, three hits or a slow-down, and a heavier kit and room are built in. Choose the original, the generated part or both, play 3/4 songs with a 3/4 style, and use Update… on an older song to get the newest bass. The Notes tab shows every bar, where you can mark a stop, a fill or a crash, or try another groove for one section. The drummer can count a song in, and a looped section ends with a proper fill when you release it.",
    image: band,
  },
  {
    title: "Your pedals follow the song",
    text: "Put MIDI cues on song times or sections and they go out over USB or Bluetooth MIDI while the song plays: program changes, CCs and named commands for the GP-150, GP-180 and other pedals. Cues name the GP-150 and GP-180 presets, and preflight checks the setup and warns if a recalled preset has changed.",
    image: midiCues,
  },
  {
    title: "Stage mode, lyrics and chords",
    text: "Lyrics come from the vocals and chords from the stems, and the chart follows playback in large type. A status strip shows the section, the bars left, what comes next and the pedal preset, and Stop and Panic need a hold so a stray tap can't end the show. An audience window and Band sync share the words with the room and your bandmates.",
    image: stageMode,
  },
  {
    title: "Where to solo",
    text: "Solo scale shows the song's scale on the neck, for the key as you play it, with the pitch shift and capo taken in. It opens on the minor pentatonic, offers seven other scales, lights up one box position at a time, and writes fret numbers or note names.",
    image: soloScales,
  },
];

function SlideCredit({ credit }: { credit: NonNullable<Slide["credit"]> }) {
  return (
    <p className="text-[12px] text-pretty text-silkscreen-3">
      Contributed by{" "}
      <button
        type="button"
        className="text-silkscreen underline underline-offset-2"
        onClick={() => void host.app.openExternal(`https://github.com/${credit.handle}`)}
      >
        @{credit.handle}
      </button>
      , {credit.note}.
    </p>
  );
}

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
          <div
            ref={track}
            onScroll={onScroll}
            className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {SLIDES.map((s, i) => (
              <section key={s.title} aria-label={`${i + 1} of ${SLIDES.length}`} className="flex w-full shrink-0 snap-start flex-col gap-3">
                <img
                  src={s.image}
                  alt=""
                  draggable={false}
                  className="aspect-[3/2] max-h-[max(120px,calc(100vh-270px))] w-full rounded-sm border border-white/10 object-cover object-top"
                />
                <h3 className="text-[15px] font-semibold">{s.title}</h3>
                <p className="text-[13px] text-pretty text-silkscreen-2">{s.text}</p>
                {s.credit && <SlideCredit credit={s.credit} />}
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
              <button
                key={s.title}
                type="button"
                aria-label={`Slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => goTo(i)}
                className="grid size-5 place-items-center"
              >
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
