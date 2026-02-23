"use client";

import { LeadContactCandidate } from "../types";
import { DuplicateResolution } from "../hooks/use-quick-add-controller";

type DuplicateResolutionPanelProps = {
  duplicateCandidates: LeadContactCandidate[];
  selectedDuplicateId: string;
  onSelectDuplicateId: (value: string) => void;
  onResolve: (resolution: DuplicateResolution) => void;
};

export function DuplicateResolutionPanel({
  duplicateCandidates,
  selectedDuplicateId,
  onSelectDuplicateId,
  onResolve,
}: DuplicateResolutionPanelProps) {
  if (duplicateCandidates.length === 0) {
    return null;
  }

  return (
    <div>
      <h3>Duplicate Resolution Required</h3>
      <label>
        Candidate
        <select value={selectedDuplicateId} onChange={(event) => onSelectDuplicateId(event.target.value)}>
          {duplicateCandidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              #{candidate.id} - {candidate.full_name} ({candidate.phone || candidate.email})
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="button" onClick={() => onResolve("use_existing")}>
          Use Existing
        </button>
        <button type="button" onClick={() => onResolve("merge_existing")}>
          Merge into Existing
        </button>
        <button type="button" onClick={() => onResolve("create_anyway")}>
          Create Anyway
        </button>
      </div>
    </div>
  );
}
