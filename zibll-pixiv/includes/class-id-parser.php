<?php
/**
 * Pixiv input parser.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

final class Zibll_Pixiv_Id_Parser
{
    /**
     * Parse a Pixiv artwork id or supported URL.
     *
     * @param string $input User supplied value.
     * @return array{id:string,page:int,user_id:string,error:string}|array{id:string,page:int,user_id:string,error:null}
     */
    public static function parse(string $input): array
    {
        $input = trim(html_entity_decode($input, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($input === '') {
            return self::error('empty');
        }

        if (preg_match('/^\[图片ID\s*:\s*([^\]]+)\]$/iu', $input, $match)) {
            $input = trim($match[1]);
        } elseif (preg_match('/^\[Image\s*ID\s*:\s*([^\]]+)\]$/iu', $input, $match)) {
            $input = trim($match[1]);
        }

        $id = '';
        $page = 1;
        $user_id = '';

        if (preg_match('/^(\d+)$/', $input, $match)) {
            $id = $match[1];
        } elseif (preg_match('/^user:(\d+)$/i', $input, $match)) {
            return self::error('missing_artwork_id');
        } else {
            $url = self::normalise_url($input);
            if ($url === null) {
                return self::error('unrecognized');
            }

            $parse_url = function_exists('wp_parse_url') ? 'wp_parse_url' : 'parse_url';
            $host = strtolower((string) $parse_url($url, PHP_URL_HOST));
            $path = (string) $parse_url($url, PHP_URL_PATH);
            $query = (string) $parse_url($url, PHP_URL_QUERY);
            $fragment = (string) $parse_url($url, PHP_URL_FRAGMENT);

            if (! self::allowed_host($host)) {
                return self::error('unrecognized');
            }

            if (in_array($host, array('pixiv.re', 'pixiv.nl'), true)) {
                if (preg_match('~^/(\d+)(?:-(\d+))?(?:\.[a-z0-9]+)?/?$~i', $path, $match)) {
                    $id = $match[1];
                    if (! empty($match[2])) {
                        $page = (int) $match[2];
                    }
                }
            } elseif (preg_match(
                '~^/users?/(\d+)/(?:artworks?|illustrations?)/(\d+)/?$~i',
                $path,
                $match
            )) {
                $user_id = $match[1];
                $id = $match[2];
                $page = self::extract_page(($fragment !== '' ? '#' . $fragment : '') . '&' . $query);
            } elseif (preg_match('~^/(?:artworks?)/(\d+)/?$~i', $path, $match)) {
                $id = $match[1];
                $page = self::extract_page(($fragment !== '' ? '#' . $fragment : '') . '&' . $query);
            } elseif (preg_match('~(?:^|&)illust_id=(\d+)(?:&|$)~i', $query, $match)) {
                $id = $match[1];
                $page = self::extract_page(($fragment !== '' ? '#' . $fragment : '') . '&' . $query);
            } else {
                return self::error('invalid');
            }
        }

        if ($id === '') {
            return self::error('invalid');
        }

        $id_result = self::validate_id($id);
        if ($id_result !== null) {
            return self::error($id_result);
        }

        if ($page < 1 || $page > 50) {
            return self::error('invalid_page');
        }

        return array(
            'id'      => $id,
            'page'    => $page,
            'user_id' => $user_id,
            'error'   => null,
        );
    }

    /**
     * Validate an artwork or user id.
     */
    public static function validate_id(string $id): ?string
    {
        if ($id === '') {
            return 'empty';
        }

        if ($id[0] === '0') {
            return 'leading_zero';
        }

        if (! preg_match('/^[1-9]\d{0,11}$/', $id)) {
            return 'invalid';
        }

        return null;
    }

    /**
     * Build a proxy URL after validating the domain and identifiers.
     */
    public static function build_proxy_url(string $domain, string $id, int $page = 1): string
    {
        $domain = strtolower(trim($domain));
        $domain = preg_replace('~^https?://~', '', $domain);
        $domain = trim((string) $domain, "/ \t\n\r\0\x0B");
        if (! in_array($domain, array('pixiv.re', 'pixiv.nl'), true)) {
            $domain = 'pixiv.re';
        }

        if (self::validate_id($id) !== null) {
            return '';
        }

        $suffix = $page > 1 ? '-' . (int) $page : '';
        return 'https://' . $domain . '/' . rawurlencode($id) . $suffix . '.jpg';
    }

    /**
     * Convert parser errors into safe user-facing messages.
     */
    public static function error_message(string $error): string
    {
        $messages = array(
            'empty'            => __('请输入 Pixiv 作品 ID 或链接', 'zibll-pixiv'),
            'missing_artwork_id' => __('请输入作品 ID，而不是仅输入画师 ID', 'zibll-pixiv'),
            'leading_zero'     => __('作品 ID 不能以 0 开头', 'zibll-pixiv'),
            'invalid'          => __('作品 ID 格式不正确', 'zibll-pixiv'),
            'invalid_page'     => __('页码格式不正确', 'zibll-pixiv'),
            'unrecognized'     => __('无法识别输入，请粘贴 Pixiv 作品链接或纯数字 ID', 'zibll-pixiv'),
        );

        return $messages[$error] ?? $messages['invalid'];
    }

    /**
     * @return array{id:string,page:int,user_id:string,error:string}
     */
    private static function error(string $code): array
    {
        return array(
            'id'      => '',
            'page'    => 1,
            'user_id' => '',
            'error'   => $code,
        );
    }

    private static function extract_page(string $input): int
    {
        if (preg_match('/^\s*(\d+)\s*$/', $input, $match)) {
            return (int) $match[1];
        }
        if (preg_match('/(?:[#&?](?:page|p)=|#)(\d+)/i', $input, $match)) {
            return (int) $match[1];
        }

        return 1;
    }

    private static function normalise_url(string $input): ?string
    {
        $input = trim($input);
        if (preg_match('~^http://~i', $input)) {
            return null;
        }
        if (! preg_match('~^(?:https?://)?(?:www\.)?[^/\s]+/.+~i', $input)) {
            return null;
        }

        $url = preg_match('~^https?://~i', $input) ? $input : 'https://' . $input;
        $parts = function_exists('wp_parse_url') ? wp_parse_url($url) : parse_url($url);
        if (! is_array($parts) || empty($parts['host'])) {
            return null;
        }

        return $url;
    }

    private static function allowed_host(string $host): bool
    {
        return in_array($host, array('pixiv.net', 'www.pixiv.net', 'pixiv.re', 'pixiv.nl'), true);
    }
}
