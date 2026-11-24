import type { Metadata } from "next";
import EncoderServiceWorkspace from "@/components/data-encoder/EncoderServiceWorkspace";

export const metadata: Metadata = {
	title: "Service details — Data Encoder",
	description: "Review service stages, documents, logistics, and assessment details.",
};

export default function EncoderServiceDetailsPage() {
	return <EncoderServiceWorkspace />;
}
