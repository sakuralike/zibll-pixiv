<?php
/**
 * Independent viewer route and rendering helpers.
 *
 * @package Zibll_Pixiv
 */

if (! defined('ABSPATH')) {
    exit;
}

final class Zibll_Pixiv_Rewrite
{
    public const VIEWER_VAR = 'zibll_pixiv_viewer';

    public static function register(): void
    {
        $slug = self::slug();
        $quoted = preg_quote($slug, '~');

        add_rewrite_tag('%' . self::VIEWER_VAR . '%', '([01])');
        add_rewrite_tag('%zibll_pixiv_id%', '([1-9][0-9]{0,11})');
        add_rewrite_tag('%zibll_pixiv_page%', '([1-9][0-9]{0,2})');
        add_rewrite_rule(
            '^' . $quoted . '/([1-9][0-9]{0,11})(?:/([1-9][0-9]{0,2}))?/?$',
            'index.php?' . self::VIEWER_VAR . '=1&zibll_pixiv_id=$matches[1]&zibll_pixiv_page=$matches[2]',
            'top'
        );
        add_rewrite_rule(
            '^' . $quoted . '/?$',
            'index.php?' . self::VIEWER_VAR . '=1',
            'top'
        );
    }

    /**
     * Register query vars used by both path and query fallback routes.
     *
     * @param string[] $vars Existing vars.
     * @return string[]
     */
    public static function query_vars(array $vars): array
    {
        $vars[] = self::VIEWER_VAR;
        $vars[] = 'zibll_pixiv_id';
        $vars[] = 'zibll_pixiv_page';
        $vars[] = 'zibll_pixiv_user';
        return array_values(array_unique($vars));
    }

    /**
     * Route the independent page to a theme-overridable template.
     */
    public static function template_include(string $template): string
    {
        if (! self::is_viewer_request()) {
            return $template;
        }

        return self::template_path();
    }

    public static function is_viewer_request(): bool
    {
        return (bool) get_query_var(self::VIEWER_VAR) || get_query_var('zibll_pixiv_id') !== '';
    }

    /**
     * Prevent WordPress from turning a valid custom route into a 404.
     *
     * @param bool     $handled Whether core already handled the 404.
     * @param WP_Query $query   Main query.
     */
    public static function prevent_404(bool $handled, WP_Query $query): bool
    {
        if (self::is_viewer_request()) {
            status_header(200);
            return false;
        }

        return $handled;
    }

    /**
     * Shortcode entry point for existing posts/pages.
     *
     * @param array<string,mixed> $atts Shortcode attributes.
     */
    public static function shortcode(array $atts = array()): string
    {
        $atts = shortcode_atts(
            array(
                'id'   => '',
                'page' => 1,
            ),
            $atts,
            'zibll_pixiv_viewer'
        );

        $parsed = Zibll_Pixiv_Id_Parser::parse((string) $atts['id']);
        if ($parsed['error'] !== null) {
            return '<p class="zibll-pixiv-error">' . esc_html(Zibll_Pixiv_Id_Parser::error_message($parsed['error'])) . '</p>';
        }

        $page = max(1, min(50, absint($atts['page'] ?: $parsed['page'])));
        ob_start();
        self::render(array(
            'id'       => $parsed['id'],
            'page'     => $page,
            'user_id'  => $parsed['user_id'],
            'embedded' => true,
        ));
        return (string) ob_get_clean();
    }

    /**
     * Render the viewer template with the current route state.
     *
     * @param array<string,mixed> $extra Rendering overrides.
     */
    public static function render(array $extra = array()): void
    {
        $options = Zibll_Pixiv_Settings::get();
        $id = (string) ($extra['id'] ?? get_query_var('zibll_pixiv_id', ''));
        $page = absint($extra['page'] ?? get_query_var('zibll_pixiv_page', 1));
        $user_id = (string) ($extra['user_id'] ?? get_query_var('zibll_pixiv_user', ''));
        $error = '';

        if ($id !== '') {
            $parsed = Zibll_Pixiv_Id_Parser::parse($id);
            if ($parsed['error'] !== null) {
                $error = Zibll_Pixiv_Id_Parser::error_message($parsed['error']);
                $id = '';
            } else {
                $id = $parsed['id'];
                $user_id = $user_id !== '' ? $user_id : $parsed['user_id'];
                $page = $page > 0 ? $page : $parsed['page'];
            }
        }

        $blocked = false;
        $blocked_message = '';
        if ($id !== '') {
            $block = Zibll_Pixiv_Settings::match_blocklist($id, $user_id, $options);
            $blocked = $block['blocked'];
            if ($blocked) {
                $blocked_message = (string) $options['blocked_message'];
                if (! empty($options['record_blocked'])) {
                    Zibll_Pixiv_Settings::record_block_hit($id, $user_id, $block['reason']);
                }
            }
        }

        $context = array(
            'options'         => $options,
            'id'              => $id,
            'page'            => max(1, min(50, $page ?: 1)),
            'user_id'         => $user_id,
            'error'           => $error,
            'blocked'         => $blocked,
            'blocked_message' => $blocked_message,
            'embedded'        => ! empty($extra['embedded']),
            'base_url'        => self::base_url(),
        );

        $template = self::template_path();
        if (isset($extra['template']) && is_string($extra['template']) && is_file($extra['template'])) {
            $template = $extra['template'];
        }
        if (is_file($template)) {
            include $template;
        }
    }

    public static function slug(): string
    {
        $options = Zibll_Pixiv_Settings::get();
        $slug = sanitize_title((string) ($options['slug'] ?? 'pixiv'));
        return $slug !== '' ? $slug : 'pixiv';
    }

    public static function template_path(): string
    {
        $theme_template = locate_template(array('zibll-pixiv/viewer.php'));
        return $theme_template !== '' ? $theme_template : ZIBLL_PIXIV_DIR . 'templates/viewer.php';
    }

    public static function base_url(): string
    {
        if (! get_option('permalink_structure')) {
            return add_query_arg(self::VIEWER_VAR, '1', home_url('/'));
        }

        return trailingslashit(home_url(self::slug()));
    }

    public static function viewer_url(string $id = '', int $page = 1, string $user_id = ''): string
    {
        if (! get_option('permalink_structure')) {
            $args = array(
                self::VIEWER_VAR => '1',
                'zibll_pixiv_id' => $id,
            );
            if ($page > 1) {
                $args['zibll_pixiv_page'] = $page;
            }
            if ($user_id !== '') {
                $args['zibll_pixiv_user'] = $user_id;
            }
            return add_query_arg($args, home_url('/'));
        }

        $url = self::base_url();
        if (Zibll_Pixiv_Id_Parser::validate_id($id) === null) {
            $url .= rawurlencode($id) . '/';
            if ($page > 1) {
                $url .= (int) $page . '/';
            }
            if ($user_id !== '' && Zibll_Pixiv_Id_Parser::validate_id($user_id) === null) {
                $url = add_query_arg('zibll_pixiv_user', rawurlencode($user_id), $url);
            }
        }
        return $url;
    }
}
