import argparse
import glob
import json
import os
import platform
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from shutil import copy2, copytree, rmtree, make_archive


class VersionManager:
    """
    This class is used to manage the version of the extension.
    It is used to get and update the version in the version.json file and the README files.
    """

    # Constants
    REGULAR_ZH = '易笺'
    REGULAR_EN = 'SimpleTextReader'
    VERSION_FORMAT = ' (v{})'

    def __init__(self, root_dir=None):
        self.root_dir = root_dir or Path(__file__).parent.parent.resolve()

    def update_version_in_files(self, new_version_str):
        """Update version number in all relevant files"""
        self._update_version_json(new_version_str)
        self._update_readme_files(new_version_str)

    def get_version(self, browsers):
        """Get current version from version.json or manifests"""
        # First try to get version from version.json
        version_file = self.root_dir / 'version.json'
        if version_file.exists():
            with open(version_file, encoding='utf-8') as f:
                return json.load(f)['version']

        # Fallback to old method if version.json doesn't exist
        if browsers:
            return self._get_version_from_manifests(browsers)
        return None

    def validate_version_str(self, version_str):
        """Validate artifact versions without relying on optimizable asserts."""
        if not isinstance(version_str, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,3}", version_str):
            raise ValueError("Version must contain one to four numeric components")
        return version_str

    def _update_version_json(self, new_version_str):
        """Update version.json file"""
        version_file = self.root_dir / 'version.json'
        with open(version_file, 'r+', encoding='utf-8') as f:
            data = json.load(f)
            data['version'] = new_version_str

            # Ensure changelog section exists
            if 'changelog' not in data:
                data['changelog'] = {}

            # If current version is not in changelog, add it
            if new_version_str not in data['changelog']:
                # Create new version entry
                data['changelog'][new_version_str] = {
                    'date': datetime.now().strftime('%Y-%m-%d'),
                    'changes': {
                        'zh': [],
                        'en': []
                    }
                }
            else:
                # Ensure existing version entry contains all necessary fields
                self._ensure_changelog_structure(
                    data['changelog'][new_version_str])

            # Sort changelog by version number in descending order
            data['changelog'] = self._sort_changelog(data['changelog'])

            # Write back to file
            f.seek(0)
            json.dump(data, f, indent=4, ensure_ascii=False)
            f.write('\n')
            f.truncate()

    def _update_readme_files(self, new_version_str):
        """Update version in README files"""
        readme_patterns = {
            'README.md': (
                rf'{self.REGULAR_ZH} \(v[\d\.]+\)',
                f'{self.REGULAR_ZH}{self.VERSION_FORMAT}'
            ),
            'README_EN.md': (
                rf'{self.REGULAR_EN} \(v[\d\.]+\)',
                f'{self.REGULAR_EN}{self.VERSION_FORMAT}'
            )
        }

        # Update both README files with different formats
        for readme_file, (pattern, template) in readme_patterns.items():
            readme_path = self.root_dir / readme_file
            if readme_path.exists():
                with open(readme_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                # Update version only for regular version
                content = re.sub(pattern, template.format(
                    new_version_str), content)

                with open(readme_path, 'w', encoding='utf-8') as f:
                    f.write(content)

    def _get_version_from_manifests(self, browsers):
        """Get version from manifest files"""
        version_strs = []
        for browser in browsers:
            manifest_path = self.root_dir / \
                f'client/manifests/{browser}/manifest.json'
            with open(manifest_path, encoding='utf-8') as f:
                manifest = json.load(f)
                version_strs.append(manifest['version'])

        assert all(x == version_strs[0] for x in version_strs), \
            'Version numbers are not the same across all browsers and versions.'
        return version_strs[0]

    @staticmethod
    def _ensure_changelog_structure(version_entry):
        """Ensure changelog entry has correct structure"""
        if 'date' not in version_entry:
            version_entry['date'] = datetime.now().strftime('%Y-%m-%d')
        if 'changes' not in version_entry or not isinstance(version_entry['changes'], dict):
            version_entry['changes'] = {'zh': [], 'en': []}
        else:
            if 'zh' not in version_entry['changes']:
                version_entry['changes']['zh'] = []
            if 'en' not in version_entry['changes']:
                version_entry['changes']['en'] = []

    @staticmethod
    def _sort_changelog(changelog):
        """Sort changelog by version number in descending order"""
        return dict(sorted(
            changelog.items(),
            key=lambda x: tuple(map(int, x[0].split('.'))),
            reverse=True
        ))


class Builder:
    """
    This class is used to build the browser extensions and Docker image.
    """

    # Constants
    BROWSERS = ['Chrome', 'Firefox']
    DOCKER_IMAGE_NAME = 'simplereader'

    def __init__(self, version_str=None):
        self.version_manager = VersionManager()
        self.root_dir = Path(__file__).parent.parent.resolve()

        # Get and validate version
        cur_version = self.version_manager.get_version(self.BROWSERS)
        self.version = version_str if version_str else cur_version
        self.version = self.version_manager.validate_version_str(self.version)

        print(f'Current Version: {cur_version}')
        print(f'New Version: {self.version}')

        # Building an artifact never changes release metadata in the checkout.

    def process_css_fonts(self, forceUpdate=False):
        # Optional font maintenance has separate dependencies and network access.
        from tqdm import tqdm
        from splitfont_css2manifest import css2manifest, save_css
        css_map = [
            {'name': 'wenkai',   'css_url': 'client/fonts/LXGWWenKaiScreen/result.css'},
            {'name': 'kinghwa',  'css_url': 'client/fonts/KingHwa_OldSong/result.css'},
            {'name': 'zhuque',   'css_url': 'client/fonts/ZhuqueFangsong-Regular/result.css'},
            {'name': 'QIJIC', 'css_url': 'https://fontsapi.zeoseven.com/81/main/result.css',
                'size_adjust': '125%'},
            {'name': 'neoxihei',
                'css_url': 'https://fontsapi.zeoseven.com/19/main/result.css'},
            {'name': 'chillkai', 'css_url': 'https://fontsapi.zeoseven.com/5/main/result.css',
                'size_adjust': '102%'},
            {'name': 'chillroundm',
                'css_url': 'https://fontsapi.zeoseven.com/243/main/result.css'},
            {'name': 'dongguan',
                'css_url': 'https://fontsapi.zeoseven.com/488/main/result.css'},
            {'name': 'quanlai',
                'css_url': 'https://fontsapi.zeoseven.com/200/main/result.css'},
            # {'name': 'sourcehan', 'css_url': 'https://fontsapi.zeoseven.com/285/main/result.css'},
            {'name': 'clearhan',
                'css_url': 'https://fontsapi.zeoseven.com/79/main/result.css'},
            {'name': 'hwmc', 'css_url': 'https://fontsapi.zeoseven.com/437/main/result.css',
                'size_adjust': '102%'},
            {'name': 'hwzk', 'css_url': 'https://fontsapi.zeoseven.com/438/main/result.css'},
            {'name': 'hwfs', 'css_url': 'https://fontsapi.zeoseven.com/440/main/result.css'},
            {'name': 'tsangeryuyang',
                'css_url': 'https://fontsapi.zeoseven.com/476/main/result.css'},
            {'name': 'tsangeryumo', 'css_url': 'https://fontsapi.zeoseven.com/479/main/result.css',
                'size_adjust': '102%'},
        ]

        for css_info in tqdm(css_map):
            out_path_json = self.root_dir / \
                f'client/fonts/local-{css_info["name"]}.json'
            out_path_css = out_path_json.with_suffix('.css')
            css_url = css_info['css_url']
            is_remote = css_url.startswith(
                "http://") or css_url.startswith("https://")
            if is_remote:
                out_path_css = str(out_path_css).replace("local", "remote")
            out_path_css = Path(out_path_css)

            # If not force update, skip if the output file already exists
            if (not forceUpdate and out_path_css.is_file()):
                continue

            print("=" * 50)
            if not is_remote:
                css_file = self.root_dir / css_url
                if not css_file.exists():
                    print(f"[WARN] CSS file not found: {css_file}")
                    print("=" * 50)
                    continue
                css_url = str(css_file)

            result = css2manifest(
                css_url, font_family_rename=css_info['name'], size_adjust=css_info.get('size_adjust'))
            print("=" * 50)

            # save manifest
            # save_manifest(result['manifest'], out_path_json)

            # save css
            save_css(result['css_patched'], out_path_css)

        print("CSS fonts processed successfully!")

    def build_extensions(self):
        """Build browser extensions"""
        print('Building extensions...')

        # Prepare dist directory
        dist_dir_name = 'dist/extensions'
        dist_dir_root = self.root_dir / dist_dir_name
        if dist_dir_root.exists():
            rmtree(dist_dir_root)

        for browser in self.BROWSERS:
            print(f'Building {browser} extension...')
            # Create dist directory for each browser
            dist_dir = dist_dir_root / browser
            dist_dir.mkdir(parents=True, exist_ok=True)

            # Override the version only in generated artifacts.
            manifest_path = self.root_dir / f'client/manifests/{browser}/manifest.json'
            with manifest_path.open(encoding='utf-8') as f:
                manifest = json.load(f)
            manifest['version'] = self.version
            (dist_dir / 'manifest.json').write_text(
                json.dumps(manifest, indent=4, ensure_ascii=False) + '\n', encoding='utf-8')
            self._copy_extension_files(dist_dir)

            # Create zip
            self._create_extension_zip(browser, dist_dir_name)

        print('Built extensions successfully!')

    def build_docker(self):
        """Build local images. Registry publishing is a separate, explicit task."""
        try:
            subprocess.run(
                ['docker', 'build', '-t', f'{self.DOCKER_IMAGE_NAME}:latest',
                 '-t', f'{self.DOCKER_IMAGE_NAME}:{self.version}', '.'],
                check=True, cwd=self.root_dir)
            return True
        except (OSError, subprocess.CalledProcessError) as error:
            print(f'[ERROR] Docker build failed: {error}')
            return False

    def _copy_extension_files(self, dist_dir):
        """Copy necessary files for extension build.

        (v2 refactor) The directory layout changed:
          - client/app/      → client/src/   (source code, ES modules)
          - client/css/      → client/src/styles/   (CSS)
          - client/app/lib/  → client/lib/   (third-party vendor libs)
          - server/          → archive/server/  (archived; not part of the
            browser extension bundle, so we don't copy it)

        The browser extension ships all client-side code + shared/ (which is
        pure JS, shared between client and the now-archived server). It does
        NOT include archive/, build-tools/, test/, or node_modules/.
        """
        # Directories to copy into the extension bundle.
        # - client/src/      : the application source (HTML imports ./client/src/modules/init-webpage.js)
        # - client/lib/      : third-party libs loaded as classic <script> tags (jQuery, tippy, etc.)
        # - client/fonts/    : web fonts
        # - client/images/   : static images
        # - client/manifests/: PWA manifest (Chrome/Firefox manifests are already copied separately)
        # - shared/          : pure JS shared between client and (archived) server; needed at runtime
        dirs_to_copy = ['client/src', 'client/lib', 'client/fonts',
                        'client/images', 'client/manifests', 'shared']
        files_to_exclude = ['FZSKBXKK.woff2',
                            'KX_47043_14.woff', 'LXGWWenKaiScreen.woff2']
        for dir_name in dirs_to_copy:
            src = self.root_dir / dir_name
            if not src.exists():
                print(f'[WARN] Source directory missing, skipping: {src}')
                continue
            copytree(src,
                     dist_dir / dir_name,
                     dirs_exist_ok=True,
                     ignore=lambda dir, files: [
                         f for f in files if f in files_to_exclude]
                     )

        # Copy individual files
        files_to_copy = ['index.html', 'version.json', 'help.json']
        for file_name in files_to_copy:
            copy2(self.root_dir / file_name, dist_dir)

        # remove font
        # os.remove(dist_dir / 'fonts' / 'FZSKBXKK.woff2')

        # Remove README files
        for readme in dist_dir.rglob('README.md'):
            readme.unlink()

    def _create_extension_zip(self, browser, dist_dir_name):
        """Archive in Python so missing zip tools cannot silently pass."""
        base = self.root_dir / dist_dir_name
        return make_archive(str(base / browser), 'zip', root_dir=base / browser)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build local SimpleTextReader artifacts (never deploys).')
    parser.add_argument('-v', '--version', default='', help='Version for generated artifacts only')
    parser.add_argument('-d', '--docker', action='store_true', help='Build a local Docker image')
    parser.add_argument('-e', '--extension', action='store_true', help='Build browser extensions')
    parser.add_argument('-a', '--all', action='store_true', help='Build extensions and a local Docker image')
    args = parser.parse_args(argv)
    if not (args.docker or args.extension or args.all):
        if args.version:
            parser.error('--version requires an explicit build target')
        parser.print_help()
        return 0
    builder = Builder(args.version)
    if args.extension or args.all:
        builder.build_extensions()
    if args.docker or args.all:
        if not builder.build_docker():
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
