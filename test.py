import os
import subprocess
from colorama import init, Fore, Style
import sys

# Initialize colorama
init(autoreset=True)

def compile_faust_file(file_path):
    try:
        # Run the Node.js script with the specified file path
        result = subprocess.run(['node', 'scripts/faust2wasm.js', file_path, 'out'], check=True, capture_output=True)
        return True, result.stdout.decode()
    except subprocess.CalledProcessError as e:
        return False, e.stderr.decode()

def search_and_compile_dsp_files(root_dir):
    for dirpath, _, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith('.dsp'):
                file_path = os.path.join(dirpath, filename)
                success, _ = compile_faust_file(file_path)
                if success:
                    print(f"{Fore.GREEN}Passed: {file_path}")
                else:
                    print(f"{Fore.RED}Failed: {file_path}")

# Set the root directory to search from

dir = "examples"


if(sys.argv.__len__() > 1):
    dir = sys.argv[1]

search_and_compile_dsp_files(dir)
