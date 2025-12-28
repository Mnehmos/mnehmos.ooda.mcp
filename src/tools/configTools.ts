// Configuration management tools
// Get and set runtime configuration values

import { z } from 'zod';
import { loadConfig, getConfigPath, updateConfigValue, getDefaultConfig, Config } from '../config.js';
import { logAudit } from '../audit.js';

// Schemas
export const GetConfigSchema = {
    section: z.string().optional().describe('Config section to retrieve (storage, cliPolicy, crud). Leave empty for full config.'),
};

export const SetConfigValueSchema = {
    key: z.string().describe('Dot-notation path to the config value (e.g., "cliPolicy.timeoutMs", "crud.defaultLimit")'),
    value: z.any().describe('New value to set. Type must match the existing value type.'),
};

export const ResetConfigSchema = {
    section: z.string().optional().describe('Section to reset to defaults. Leave empty to reset all.'),
};

/**
 * Get current configuration
 */
export async function handleGetConfig(args: {
    section?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
        const config = loadConfig();
        const configPath = getConfigPath();
        
        let result: any;
        if (args.section) {
            const section = args.section as keyof Config;
            if (config[section] === undefined) {
                return {
                    content: [{
                        type: 'text',
                        text: `Error: Unknown config section: ${args.section}. Valid sections: storage, cliPolicy, crud`
                    }],
                };
            }
            result = {
                section: args.section,
                values: config[section],
            };
        } else {
            result = {
                configPath,
                config,
                defaults: getDefaultConfig(),
            };
        }

        await logAudit('get_config', args, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('get_config', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
        };
    }
}

/**
 * Set a specific configuration value
 */
export async function handleSetConfigValue(args: {
    key: string;
    value: any;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const oldConfig = loadConfig();
        
        // Get old value for logging
        const keys = args.key.split('.');
        let oldValue: any = oldConfig;
        for (const k of keys) {
            oldValue = oldValue?.[k];
        }

        // Update the value
        const newConfig = updateConfigValue(args.key, args.value);

        await logAudit('set_config_value', { key: args.key, oldValue, newValue: args.value }, 'updated');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    key: args.key,
                    oldValue,
                    newValue: args.value,
                    currentConfig: newConfig,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('set_config_value', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Reset configuration to defaults
 */
export async function handleResetConfig(args: {
    section?: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
        const defaults = getDefaultConfig();
        const currentConfig = loadConfig();
        
        let newConfig: Config;
        
        if (args.section) {
            const section = args.section as keyof Config;
            if (defaults[section] === undefined) {
                return {
                    content: [{
                        type: 'text',
                        text: `Error: Unknown config section: ${args.section}. Valid sections: storage, cliPolicy, crud`
                    }],
                };
            }
            // Reset just one section
            newConfig = {
                ...currentConfig,
                [section]: { ...defaults[section] },
            };
        } else {
            // Reset all
            newConfig = { ...defaults };
        }

        // Save the config using the existing function
        const fs = await import('fs');
        const configPath = getConfigPath();
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');

        await logAudit('reset_config', args, 'reset');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    reset: args.section || 'all',
                    newConfig,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('reset_config', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
        };
    }
}
