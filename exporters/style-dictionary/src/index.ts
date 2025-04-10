import {
  Supernova,
  PulsarContext,
  RemoteVersionIdentifier,
  AnyOutputFile,
  TokenType,
  TokenTheme,
  Token
} from "@supernovaio/sdk-exporters"
import { ExporterConfiguration, ThemeExportStyle, FileStructure } from "../config"
import { styleOutputFile, combinedStyleOutputFile } from "./files/style-file"
import { StringCase, ThemeHelper } from "@supernovaio/export-utils"
import { deepMerge } from "./utils/token-hierarchy"

/** Exporter configuration from the resolved default configuration and user overrides */
export const exportConfiguration = Pulsar.exportConfig<ExporterConfiguration>()

/**
 * Filters out null values from an array of output files
 * @param files Array of output files that may contain null values
 * @returns Array of non-null output files
 */
function processOutputFiles(files: Array<AnyOutputFile | null>): Array<AnyOutputFile> {
  return files.filter((file): file is AnyOutputFile => file !== null)
}

/**
 * Main export function that generates CSS files from design tokens
 *
 * This function handles:
 * - Fetching tokens and token groups from the design system
 * - Filtering tokens by brand if specified
 * - Processing themes in different modes (direct, separate files, or combined)
 * - Generating style files for each token type
 *
 * @param sdk - Supernova SDK instance
 * @param context - Export context containing design system information
 * @returns Promise resolving to an array of output files
 */
Pulsar.export(async (sdk: Supernova, context: PulsarContext): Promise<Array<AnyOutputFile>> => {
  // Fetch data from design system that is currently being exported
  const remoteVersionIdentifier: RemoteVersionIdentifier = {
    designSystemId: context.dsId,
    versionId: context.versionId
  }

  // Fetch tokens, groups and collections
  let tokens = await sdk.tokens.getTokens(remoteVersionIdentifier)
  let tokenGroups = await sdk.tokens.getTokenGroups(remoteVersionIdentifier)
  let tokenCollections = await sdk.tokens.getTokenCollections(remoteVersionIdentifier)
  let brandName: string | null = null

  // Filter by brand if specified
  if (context.brandId) {
    const brands = await sdk.brands.getBrands(remoteVersionIdentifier)
    const brand = brands.find((brand) => brand.id === context.brandId || brand.idInVersion === context.brandId)
    if (!brand) {
      throw new Error(`Unable to find brand ${context.brandId}.`)
    }
    brandName = brand.name
    tokens = tokens.filter((token) => token.brandId === brand.id)
    tokenGroups = tokenGroups.filter((tokenGroup) => tokenGroup.brandId === brand.id)
  }

  // Process themes if specified
  const themes = await sdk.tokens.getTokenThemes(remoteVersionIdentifier)

  // Use selected themes if specified, otherwise use all available themes
  const themesToApply =
    context.themeIds && context.themeIds.length > 0
      ? context.themeIds.map((themeId) => {
          const theme = themes.find((theme) => theme.id === themeId || theme.idInVersion === themeId)
          if (!theme) {
            throw new Error(`Unable to find theme ${themeId}`)
          }
          return theme
        })
      : themes

  if (!themesToApply.length) {
    return []
  }

  // Define which token types are themed (color, opacity, shadow)
  const themedTokenTypes = [TokenType.color, TokenType.opacity, TokenType.shadow]

  // Define which token types are primitives (everything else)
  const primitiveTokenTypes = Object.values(TokenType).filter((type) => !themedTokenTypes.includes(type))

  // PART 1: Handle themed tokens with SeparateFiles style
  // Generate separate files for themed token types using ThemeExportStyle.SeparateFiles
  const themedFiles = themesToApply.flatMap((theme) => {
    const themedTokens = sdk.tokens.computeTokensByApplyingThemes(tokens, tokens, [theme])
    const expandedThemedTokens = themedTokens.map(
      (token) =>
        ({
          ...token,
          collectionId: tokens.find((t) => t.id === token.id)?.collectionId
        }) as Token
    )

    const themePath = ThemeHelper.getThemeIdentifier(theme, StringCase.camelCase)

    // Only include themed token types (color, opacity, shadow)
    // Filter tokens to only include themed types before processing
    const themedTokensOnly = expandedThemedTokens.filter((token) => themedTokenTypes.includes(token.tokenType))

    // Use SeparateFiles approach for themed tokens
    const originalExportStyle = exportConfiguration.exportThemesAs
    exportConfiguration.exportThemesAs = ThemeExportStyle.SeparateFiles

    // Process once per theme, but only for themed token types
    const files = themedTokenTypes.map((type) =>
      styleOutputFile(type, themedTokensOnly, tokenGroups, themePath, theme, tokenCollections, brandName)
    )

    // Restore original config
    exportConfiguration.exportThemesAs = originalExportStyle
    return files
  })

  // PART 2: Handle primitive tokens with NestedThemes style
  // For primitives, we'll use the NestedThemes style
  const primitiveFiles = primitiveTokenTypes.map((type) => {
    // Use NestedThemes approach for primitive tokens
    const originalExportStyle = exportConfiguration.exportThemesAs
    exportConfiguration.exportThemesAs = ThemeExportStyle.NestedThemes

    // We can process all themes in one go with NestedThemes
    const allThemedTokens = sdk.tokens.computeTokensByApplyingThemes(tokens, tokens, themesToApply)

    // Filter to only include tokens of the current primitive type
    const tokensOfType = allThemedTokens.filter((token) => token.tokenType === type)

    // For primitives, we don't pass a theme path
    const file = styleOutputFile(type, tokensOfType, tokenGroups, "", undefined, tokenCollections, brandName)

    // Restore original config
    exportConfiguration.exportThemesAs = originalExportStyle
    return file
  })

  // Combine both themed and primitive files
  return processOutputFiles([...themedFiles, ...primitiveFiles])
})
