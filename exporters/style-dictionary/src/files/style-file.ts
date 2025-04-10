import {
  FileHelper,
  CSSHelper,
  GeneralHelper,
  ThemeHelper,
  FileNameHelper,
  StringCase
} from "@supernovaio/export-utils"
import { OutputTextFile, Token, TokenGroup, TokenType } from "@supernovaio/sdk-exporters"
import { DesignSystemCollection } from "@supernovaio/sdk-exporters/build/sdk-typescript/src/model/base/SDKDesignSystemCollection"
import { exportConfiguration } from ".."
import { tokenObjectKeyName, resetTokenNameTracking, getTokenPrefix } from "../content/token"
import { TokenTheme } from "@supernovaio/sdk-exporters"
import { DEFAULT_STYLE_FILE_NAMES } from "../constants/defaults"
import { createHierarchicalStructure, deepMerge, processTokenName } from "../utils/token-hierarchy"
import { NamingHelper } from "@supernovaio/export-utils"
import { ThemeExportStyle, TokenNameStructure } from "../../config"

/**
 * Creates a value object for a token, either as a simple value or themed values
 */
function createTokenValue(
  value: string,
  token: Token,
  theme?: TokenTheme,
  collections: Array<DesignSystemCollection> = []
): any {
  const baseValue = value.replace(/['"]/g, "")
  const description =
    token.description && exportConfiguration.showDescriptions ? { description: token.description.trim() } : {}

  // Get the token type, forcing a return value even when prefixes are disabled
  const tokenType = getTokenPrefix(token.tokenType, true)

  // For nested themes style, create an object with theme-specific values
  if (exportConfiguration.exportThemesAs === ThemeExportStyle.NestedThemes) {
    const valueObject = {}

    // Add themed value if theme is provided
    if (theme) {
      valueObject[ThemeHelper.getThemeIdentifier(theme, StringCase.kebabCase)] = {
        value: baseValue,
        type: tokenType,
        collection: collections?.find((c) => c.persistentId === token.collectionId)?.name
      }
    }

    // Add description last
    return {
      ...valueObject,
      ...description
    }
  }

  // Default case - return simple value object with type
  return {
    value: baseValue,
    type: tokenType,
    collection: collections?.find((c) => c.persistentId === token.collectionId)?.name,
    ...description
  }
}

function processTokensToObject(
  tokens: Array<Token>,
  tokenGroups: Array<TokenGroup>,
  theme?: TokenTheme,
  collections: Array<DesignSystemCollection> = [],
  allTokens?: Array<Token>
): any | null {
  // Clear any previously cached token names to ensure clean generation
  resetTokenNameTracking()

  // Skip generating empty files unless explicitly configured to do so
  if (!exportConfiguration.generateEmptyFiles && tokens.length === 0) {
    return null
  }

  // Create a lookup map for quick token reference resolution using all tokens
  // This ensures that references to tokens outside the current filtered set still work
  const mappedTokens = new Map((allTokens || tokens).map((token) => [token.id, token]))

  // Sort tokens if configured
  // This can make it easier to find tokens in the generated files
  let sortedTokens = [...tokens]
  if (exportConfiguration.tokenSortOrder === "alphabetical") {
    sortedTokens.sort((a, b) => {
      const nameA = tokenObjectKeyName(a, tokenGroups, true, collections)
      const nameB = tokenObjectKeyName(b, tokenGroups, true, collections)
      return nameA.localeCompare(nameB)
    })
  }

  // Initialize the root object that will contain all processed tokens
  const tokenObject: any = {}

  // Add generated file disclaimer if enabled
  // This helps users understand that the file is auto-generated
  if (exportConfiguration.showGeneratedFileDisclaimer) {
    tokenObject._comment = exportConfiguration.disclaimer
  }

  // Process each token and build the hierarchical structure
  sortedTokens.forEach((token) => {
    // Generate the token's object key name based on configuration
    const name = tokenObjectKeyName(token, tokenGroups, true, collections)

    // Convert token to CSS-compatible value, handling references and formatting
    const value = CSSHelper.tokenToCSS(token, mappedTokens, {
      allowReferences: exportConfiguration.useReferences,
      decimals: exportConfiguration.colorPrecision,
      colorFormat: exportConfiguration.colorFormat,
      forceRemUnit: exportConfiguration.forceRemUnit,
      remBase: exportConfiguration.remBase,
      tokenToVariableRef: (t) => {
        // Build the reference path based on token structure configuration
        const prefix = getTokenPrefix(t.tokenType)
        const pathSegments = (t.tokenPath || [])
          .filter((segment) => segment && segment.trim().length > 0)
          .map((segment) => NamingHelper.codeSafeVariableName(segment, exportConfiguration.tokenNameStyle))

        const tokenName = processTokenName(t, pathSegments)

        // Build segments array based on configuration
        let segments: string[] = []
        if (prefix) {
          segments.push(prefix)
        }

        // Handle different token name structure configurations
        switch (exportConfiguration.tokenNameStructure) {
          case TokenNameStructure.NameOnly:
            segments.push(tokenName)
            break

          case TokenNameStructure.CollectionPathAndName:
            // Include collection name in the path if available
            if (t.collectionId) {
              const collection = collections.find((c) => c.persistentId === t.collectionId)
              if (collection) {
                const collectionSegment = NamingHelper.codeSafeVariableName(
                  collection.name,
                  exportConfiguration.tokenNameStyle
                )
                segments.push(collectionSegment)
              }
            }
            segments.push(...pathSegments, tokenName)
            break

          case TokenNameStructure.PathAndName:
            segments.push(...pathSegments, tokenName)
            break
        }

        // Add global prefix if configured
        if (exportConfiguration.globalNamePrefix) {
          segments.unshift(
            NamingHelper.codeSafeVariableName(exportConfiguration.globalNamePrefix, exportConfiguration.tokenNameStyle)
          )
        }

        return `{${segments.join(".")}}`
      }
    })

    // Create the hierarchical object structure for this token
    const hierarchicalObject = createHierarchicalStructure(
      token.tokenPath || [],
      token.name,
      createTokenValue(value, token, theme, collections),
      token,
      collections
    )

    // Merge the token's object structure into the main object
    Object.assign(tokenObject, deepMerge(tokenObject, hierarchicalObject))
  })

  return tokenObject
}

export function styleOutputFile(
  type: TokenType,
  tokens: Array<Token>,
  tokenGroups: Array<TokenGroup>,
  themePath: string = "",
  theme?: TokenTheme,
  collections: Array<DesignSystemCollection> = [],
  brandName?: string | null
): OutputTextFile | null {
  // Filter to only include tokens of the specified type (color, size, etc)
  let tokensOfType = tokens.filter((token) => token.tokenType === type)

  // For themed token files:
  // - Filter to only include tokens that are overridden in this theme
  // - Skip generating the file if no tokens are themed (when configured)
  if (themePath && theme && exportConfiguration.exportOnlyThemedTokens) {
    tokensOfType = ThemeHelper.filterThemedTokens(tokensOfType, theme)

    if (tokensOfType.length === 0) {
      return null
    }
  }

  // Process tokens into a structured object
  // Pass the full tokens array for reference resolution
  const tokenObject = processTokensToObject(tokensOfType, tokenGroups, theme, collections, tokens)
  if (!tokenObject) {
    return null
  }

  // Generate the final JSON content with proper indentation
  const content = JSON.stringify(tokenObject, null, exportConfiguration.indent)

  // Create and return the output file with appropriate path and name
  return FileHelper.createTextFile({
    relativePath: themePath ? `./${themePath}` : exportConfiguration.baseStyleFilePath,
    fileName: exportConfiguration.customizeStyleFileNames
      ? FileNameHelper.ensureFileExtension(exportConfiguration.styleFileNames[type], ".json")
      : DEFAULT_STYLE_FILE_NAMES[type],
    content: content
  })
}
