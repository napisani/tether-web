{
  description = "tether-web development shell";

  inputs = {
    # Keep unstable everywhere; nixpkgs 26.11 dropped x86_64-darwin (Intel
    # Macs), so pin that one system to the 26.05-darwin branch (the last
    # release supporting it, security fixes until end of 2026).
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nixpkgs-darwin.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, nixpkgs-darwin, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        # Only x86_64-darwin (Intel Macs) needs the 26.05 branch; everything
        # else (arm64 Macs, Linux) stays on nixpkgs-unstable.
        pkgs = (if system == "x86_64-darwin" then nixpkgs-darwin else nixpkgs).legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Build and test tooling
            go
            nodejs_24
            gnumake
            git
          ];

          shellHook = ''
            echo "tether-web dev shell — go $(go version | awk '{print $3}') — node $(node --version)"
          '';
        };
      }
    );
}
