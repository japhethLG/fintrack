"use client";

import React, { useState, useEffect } from "react";
import { Button, Input, Alert, Icon } from "@/components/common";
import {
  getApiKeyConfig,
  setUserApiKey,
  clearUserApiKey,
  isProduction,
} from "@/lib/services/apiKeyService";

export interface IModalData {
  onSave?: () => void;
}

export interface IProps {
  closeModal: () => void;
  modalData: IModalData;
}

const ApiKeyModal: React.FC<IProps> = ({ closeModal, modalData }) => {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const config = getApiKeyConfig();
    setHasExistingKey(!!config.userKey);
    if (config.userKey) {
      // Show masked version
      setApiKey("•".repeat(20));
    }
  }, []);

  const handleSave = async () => {
    if (!apiKey || apiKey === "•".repeat(20)) {
      setError("Please enter an API key");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Basic validation - check if key looks valid
      if (!apiKey.startsWith("AI") || apiKey.length < 30) {
        setError("Invalid API key format. Gemini API keys typically start with 'AI'.");
        setIsSaving(false);
        return;
      }

      await setUserApiKey(apiKey);
      modalData.onSave?.();
      closeModal();
    } catch (err) {
      setError("Failed to save API key");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    clearUserApiKey();
    setApiKey("");
    setHasExistingKey(false);
  };

  const config = getApiKeyConfig();

  return (
    <div className="space-y-4">
      <Alert variant={isProduction() ? "warning" : "info"}>
        {isProduction()
          ? "API key required in production. Your key is stored locally in your browser."
          : "Optional in development. You can use your own key or the environment variable."}
      </Alert>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Icon name="key" size={16} />
          <span>Gemini API Key</span>
          {hasExistingKey && (
            <span className="px-2 py-0.5 bg-success/20 text-success text-xs rounded">
              Configured
            </span>
          )}
        </div>

        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError(null);
            }}
            placeholder="Enter your Gemini API key (starts with AI...)"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
          >
            <Icon name={showKey ? "visibility_off" : "visibility"} size={18} />
          </button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <p className="text-xs text-gray-500">
          Get your free API key from{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Google AI Studio
          </a>
        </p>

        {config.envKeyAvailable && !isProduction() && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Icon name="check_circle" size={14} className="text-success" />
            Environment variable is configured (will be used as fallback)
          </p>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        {hasExistingKey && (
          <Button variant="ghost" onClick={handleClear} className="text-danger">
            Clear Key
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={closeModal}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} loading={isSaving}>
          Save Key
        </Button>
      </div>
    </div>
  );
};

export default ApiKeyModal;
