<?php
/**
 * Administrator-only environment and reachability diagnostics.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

final class Zibll_Pixiv_Rest_Api
{
    private const RESOLUTION_CACHE_TTL = 900;

    private const RESOLUTION_RATE_LIMIT = 30;

    public static function register(): void
    {
        register_rest_route(
            'zibll-pixiv/v1',
            '/environment',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array(__CLASS__, 'environment'),
                'permission_callback' => static function (): bool {
                    return current_user_can('manage_options');
                },
            )
        );

        register_rest_route(
            'zibll-pixiv/v1',
            '/artwork/(?P<id>\d{1,12})',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array(__CLASS__, 'resolve_artwork'),
                'permission_callback' => '__return_true',
            )
        );
    }

    /**
     * Resolve Pixiv artwork IDs to direct image URLs without proxying image data.
     *
     * @return WP_REST_Response|WP_Error
     */
    public static function resolve_artwork(WP_REST_Request $request)
    {
        $id = (string) $request->get_param('id');
        if (Zibll_Pixiv_Id_Parser::validate_id($id) !== null) {
            return new WP_Error('zibll_pixiv_invalid_id', __('作品 ID 格式不正确。', 'zibll-pixiv'), array('status' => 400));
        }

        $options = Zibll_Pixiv_Settings::get();
        if (Zibll_Pixiv_Settings::match_blocklist($id, '', $options)['blocked']) {
            return new WP_Error('zibll_pixiv_blocked', __('该作品已被本站屏蔽。', 'zibll-pixiv'), array('status' => 403));
        }

        $cache_key = 'zibll_pixiv_artwork_' . $id;
        $resolved = get_transient($cache_key);
        if (! is_array($resolved) || empty($resolved['paths'])) {
            if (self::resolution_rate_limited()) {
                return new WP_Error('zibll_pixiv_rate_limited', __('请求过于频繁，请稍后重试。', 'zibll-pixiv'), array('status' => 429));
            }

            $response = wp_remote_post(
                'https://api.pixiv.cat/v1/generate',
                array(
                    'timeout' => max(3, min(30, (int) $options['timeout'])),
                    'headers' => array('Accept' => 'application/json'),
                    'body'    => array('p' => $id),
                )
            );
            if (is_wp_error($response)) {
                return new WP_Error('zibll_pixiv_resolver_unavailable', __('作品解析服务暂时不可用。', 'zibll-pixiv'), array('status' => 502));
            }

            $status = (int) wp_remote_retrieve_response_code($response);
            if ($status === 404) {
                return new WP_Error('zibll_pixiv_artwork_not_found', __('作品不存在或无法访问。', 'zibll-pixiv'), array('status' => 404));
            }
            if ($status < 200 || $status >= 300) {
                return new WP_Error('zibll_pixiv_resolver_error', __('作品解析服务暂时不可用。', 'zibll-pixiv'), array('status' => 502));
            }

            $payload = json_decode(wp_remote_retrieve_body($response), true);
            if (! is_array($payload) || empty($payload['success'])) {
                return new WP_Error('zibll_pixiv_artwork_not_found', __('作品不存在或无法访问。', 'zibll-pixiv'), array('status' => 404));
            }

            $source_urls = $payload['original_urls_proxy'] ?? array();
            if (! is_array($source_urls) || empty($source_urls)) {
                $source_urls = ! empty($payload['original_url_proxy']) ? array($payload['original_url_proxy']) : array();
            }

            $paths = array();
            foreach ($source_urls as $source_url) {
                $path = self::pixiv_original_path($source_url);
                if ($path !== '') {
                    $paths[] = $path;
                }
            }
            $paths = array_values(array_unique($paths));
            if (empty($paths)) {
                return new WP_Error('zibll_pixiv_invalid_resolver_response', __('作品解析服务返回了无效图片地址。', 'zibll-pixiv'), array('status' => 502));
            }

            $resolved = array(
                'paths'     => $paths,
                'artist_id' => isset($payload['artist']['id']) ? absint($payload['artist']['id']) : 0,
            );
            set_transient($cache_key, $resolved, self::RESOLUTION_CACHE_TTL);
        }

        $artist_id = (string) ($resolved['artist_id'] ?? '');
        if ($artist_id !== '' && Zibll_Pixiv_Settings::match_blocklist($id, $artist_id, $options)['blocked']) {
            return new WP_Error('zibll_pixiv_blocked', __('该作品已被本站屏蔽。', 'zibll-pixiv'), array('status' => 403));
        }

        $domains = Zibll_Pixiv_Request_Policy::configured_domains($options);
        $total = count($resolved['paths']);
        $pages = array();
        foreach (array_slice($resolved['paths'], 0, 50) as $index => $path) {
            $urls = array();
            foreach ($domains as $domain) {
                $urls[] = 'https://i.' . $domain . $path;
            }
            $pages[] = array(
                'page' => $index + 1,
                'urls' => $urls,
            );
        }

        return new WP_REST_Response(
            array(
                'id'       => $id,
                'pages'    => $pages,
                'total'    => $total,
                'has_more' => $total > count($pages),
            )
        );
    }

    private static function resolution_rate_limited(): bool
    {
        $address = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if ($address === '') {
            return false;
        }

        $key = 'zibll_pixiv_resolve_' . hash_hmac('sha256', $address, wp_salt('auth'));
        $count = (int) get_transient($key);
        if ($count >= self::RESOLUTION_RATE_LIMIT) {
            return true;
        }

        set_transient($key, $count + 1, MINUTE_IN_SECONDS);
        return false;
    }

    private static function pixiv_original_path($url): string
    {
        if (! is_string($url)) {
            return '';
        }

        $parts = wp_parse_url($url);
        if (
            ! is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || strtolower((string) ($parts['host'] ?? '')) !== 'i.pixiv.cat'
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            return '';
        }

        $path = (string) ($parts['path'] ?? '');
        if (
            ! str_starts_with($path, '/img-original/')
            || str_contains(rawurldecode($path), '..')
            || ! preg_match('~^/img-original/[A-Za-z0-9._/%-]+$~D', $path)
        ) {
            return '';
        }

        return $path;
    }

    /**
     * @return WP_REST_Response
     */
    public static function environment(): WP_REST_Response
    {
        global $wp_rewrite, $wpdb;

        $options = Zibll_Pixiv_Settings::get();
        $php_version = PHP_VERSION;
        $wp_version = get_bloginfo('version');
        $db_version = method_exists($wpdb, 'db_version') ? $wpdb->db_version() : '';
        $theme = wp_get_theme();
        $rewrite = (bool) get_option('permalink_structure');
        $probes = array();

        foreach (Zibll_Pixiv_Request_Policy::configured_domains($options) as $domain) {
            $probes[$domain] = Zibll_Pixiv_Request_Policy::probe($domain, min(5, (int) $options['timeout']));
        }

        return new WP_REST_Response(
            array(
                'php' => array(
                    'version' => $php_version,
                    'meets_minimum' => version_compare($php_version, '8.0', '>='),
                ),
                'wordpress' => array(
                    'version' => $wp_version,
                    'meets_minimum' => version_compare($wp_version, '7.0', '>='),
                ),
                'database' => array(
                    'version' => $db_version,
                    'meets_minimum' => $db_version === '' || version_compare($db_version, '8.0', '>='),
                ),
                'theme' => array(
                    'name' => $theme->get('Name'),
                    'version' => $theme->get('Version'),
                    'active' => $theme->exists(),
                ),
                'rewrite' => array(
                    'permalink_structure' => (string) get_option('permalink_structure'),
                    'configured' => $rewrite,
                    'rules_loaded' => is_object($wp_rewrite) && ! empty($wp_rewrite->rules),
                ),
                'proxy' => $probes,
                'filter' => Zibll_Pixiv_Settings::blocklist_status($options),
                'server_image_proxy' => false,
            )
        );
    }
}
