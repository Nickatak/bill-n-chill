import type { Metadata } from "next";
import { LandingPage } from "./landing-page";

export const metadata: Metadata = {
  title: "Bill n Chill — Construction Finance Made Simple",
};

export default function Home() {
  return <LandingPage />;
}
