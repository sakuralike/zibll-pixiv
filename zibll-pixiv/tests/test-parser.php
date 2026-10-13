<?php
/**
 * Standalone parser checks.
 *
 * Run with: php tests/test-parser.php
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

$cases = array(
    array('82775556', '82775556', 1, '', ''),
    array('https://www.pixiv.net/artworks/82775556#2', '82775556', 2, '', ''),
    array('https://www.pixiv.net/member_illust.php?mode=medium&illust_id=82775556', '82775556', 1, '', ''),
    array('https://pixiv.re/82775556-2.jpg', '82775556', 2, '', ''),
    array('https://pixiv.net/users/42/artworks/82775556', '82775556', 1, '42', ''),
    array('https://evil.com/artworks/82775556', '', 1, '', 'unrecognized'),
    array('http://www.pixiv.net/artworks/82775556', '', 1, '', 'unrecognized'),
    array('https://pixiv.re/not-an-id.jpg', '', 1, '', 'invalid'),
    array('082775556', '', 1, '', 'leading_zero'),
    array('8277555600000', '', 1, '', 'invalid'),
);

$failures = array();
foreach ($cases as $case) {
    $result = Zibll_Pixiv_Id_Parser::parse($case[0]);
    if ($case[4] !== '') {
        if ($result['error'] !== $case[4]) {
            $failures[] = $case[0] . ' expected error ' . $case[4];
        }
        continue;
    }
    if ($result['error'] !== null || $result['id'] !== $case[1] || $result['page'] !== $case[2] || $result['user_id'] !== $case[3]) {
        $failures[] = $case[0] . ' parsed unexpectedly: ' . json_encode($result);
    }
}

if ($failures !== array()) {
    fwrite(STDERR, "FAIL\n" . implode("\n", $failures) . "\n");
    exit(1);
}

echo "PASS parser (" . count($cases) . " cases)\n";
