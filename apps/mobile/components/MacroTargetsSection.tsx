import React, { useState } from 'react';
import type { MacroValues } from '@/lib/macroPresets';
import { MacroTargetsDisplay } from './MacroTargetsDisplay';
import { MacroTargetsEditForm } from './MacroTargetsEditForm';

export interface MacroTargetsSectionProps {
  targets: MacroValues | null;
  onSave: (values: MacroValues) => Promise<void>;
  onSetupPress: () => void;
}

const EMPTY: MacroValues = { protein: '', carbs: '', fat: '', calories: '' };

export function MacroTargetsSection({ targets, onSave, onSetupPress }: MacroTargetsSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MacroValues>(EMPTY);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleEditPress() {
    setDraft(targets ? { ...targets } : EMPTY);
    setSaveError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    try {
      await onSave(draft);
      setEditing(false);
      setSaveError(null);
    } catch {
      setSaveError('Failed to save. Please try again.');
    }
  }

  function handleChangeField(key: keyof MacroValues, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  if (editing) {
    return (
      <MacroTargetsEditForm
        draft={draft}
        saveError={saveError}
        onChangeField={handleChangeField}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <MacroTargetsDisplay
      targets={targets ?? EMPTY}
      onEditPress={handleEditPress}
      onSetupPress={onSetupPress}
    />
  );
}
