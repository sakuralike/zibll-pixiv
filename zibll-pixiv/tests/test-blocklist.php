<?php
/**
 * Standalone local blocklist checks.
 *
 * Run with: php tests/test-blocklist.php
 */

declare(strict_types=1);

define('ABSPATH', __DIR__);
if (! function_exists('__')) {
    function __($text, $domain = null)
    {
        return $text;
    }
}

require dirname(__DIR__) . '/includes/class-id-parser.php';
require dirname(__DIR__) . '/includes/class-settings.php';

$raw = " # comment\n82775556\nuser:42\ninvalid-value\n82775556 # duplicate\n";
$normalized = Zibll_Pixiv_Settings::normalize_blocklist($raw);
$expected = "82775556\nuser:42";
if ($normalized !== $expected) {
    fwrite(STDERR, "FAIL normalize: " . var_export($normalized, true) . "\n");
    exit(1);
}

$options = Zibll_Pixiv_Settings::defaults();
$options['filter_enabled'] = 1;
$options['blocklist'] = $normalized;
$hitArtwork = Zibll_Pixiv_Settings::match_blocklist('82775556', '', $options);
$hitUser = Zibll_Pixiv_Settings::match_blocklist('99999999', '42', $options);
$miss = Zibll_Pixiv_Settings::match_blocklist('99999999', '7', $options);
$disabledOptions = $options;
$disabledOptions['filter_enabled'] = 0;
$disabled = Zibll_Pixiv_Settings::match_blocklist('82775556', '', $disabledOptions);

if (! $hitArtwork['blocked'] || $hitArtwork['reason'] !== 'artwork') {
    fwrite(STDERR, "FAIL artwork match\n");
    exit(1);
}
if (! $hitUser['blocked'] || $hitUser['reason'] !== 'user') {
    fwrite(STDERR, "FAIL user match\n");
    exit(1);
}
if ($miss['blocked'] || $disabled['blocked']) {
    fwrite(STDERR, "FAIL false positive\n");
    exit(1);
}

echo "PASS blocklist (normalization, artwork, user, disabled)\n";
