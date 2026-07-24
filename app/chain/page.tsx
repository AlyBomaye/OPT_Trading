import { OptionChain } from "@/components/OptionChain";
import { TermStructure } from "@/components/TermStructure";
import { VolSmile } from "@/components/VolSmile";

export default function ChainPage() {
  return (
    <>
      <OptionChain />
      <TermStructure />
      <VolSmile />
    </>
  );
}
